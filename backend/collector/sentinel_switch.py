"""OS-Ken OpenFlow 1.3 learning switch with exact IPv4 telemetry matches.

Run on a dedicated Linux controller using os-ken==2.11.2 with osken-manager
collector/sentinel_switch.py. Existing controllers may be used
if they expose compatible REST flow stats and exact IPv4 flow matches.
"""

import json
from ipaddress import IPv4Address

from os_ken.base import app_manager
from os_ken.app.ofctl import api
from os_ken.lib import hub
from os_ken.controller import ofp_event
from os_ken.controller.handler import CONFIG_DISPATCHER, MAIN_DISPATCHER, set_ev_cls
from os_ken.ofproto import ofproto_v1_3
from os_ken.lib.packet import ethernet, ether_types, ipv4, packet, tcp, udp


class SentinelSwitch(app_manager.OSKenApp):
    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.mac_to_port = {}
        self.rest_server = hub.WSGIServer(("127.0.0.1", 8080), self.rest)
        hub.spawn(self.rest_server.serve_forever)

    def rest(self, environ, start_response):
        """Private controller-local subset of the Ryu REST contract used by the collector."""
        try:
            path, method = environ["PATH_INFO"], environ["REQUEST_METHOD"]
            if method == "GET" and path == "/stats/switches":
                result = [dp.id for dp in api.get_datapath(self)]
            elif method == "GET" and path.startswith("/stats/flow/"):
                dpid = int(path.rsplit("/", 1)[-1])
                dp = api.get_datapath(self, dpid)
                if not dp:
                    raise ValueError("Unknown switch")
                parser = dp.ofproto_parser
                replies = api.send_msg(
                    self, parser.OFPFlowStatsRequest(dp), reply_cls=parser.OFPFlowStatsReply, reply_multi=True
                )
                entries = []
                for reply in replies:
                    for stat in reply.body:
                        actions = [
                            str(action)
                            for inst in stat.instructions
                            for action in getattr(inst, "actions", [])
                        ]
                        entries.append(
                            {
                                "match": dict(stat.match.items()),
                                "cookie": stat.cookie,
                                "table_id": stat.table_id,
                                "priority": stat.priority,
                                "packet_count": stat.packet_count,
                                "byte_count": stat.byte_count,
                                "duration_sec": stat.duration_sec,
                                "duration_nsec": stat.duration_nsec,
                                "actions": actions,
                            }
                        )
                result = {str(dpid): entries}
            elif method == "POST" and path in ("/stats/flowentry/add", "/stats/flowentry/delete_strict"):
                size = int(environ.get("CONTENT_LENGTH") or "0")
                if not 0 < size < 8192:
                    raise ValueError("Invalid request size")
                body = json.loads(environ["wsgi.input"].read(size))
                dp = api.get_datapath(self, int(body["dpid"]))
                if not dp or body["priority"] != 50000:
                    raise ValueError("Unknown switch or unsupported priority")
                fields = body["match"]
                IPv4Address(fields["ipv4_src"])
                IPv4Address(fields["ipv4_dst"])
                if fields["eth_type"] != 2048 or fields["ip_proto"] not in (1, 6, 17):
                    raise ValueError("Only scoped IPv4 rules are accepted")
                parser, ofp = dp.ofproto_parser, dp.ofproto
                block = path.endswith("/add")
                if block and (body.get("actions") != [] or body.get("hard_timeout") != 300):
                    raise ValueError("Only temporary drop rules are accepted")
                message = parser.OFPFlowMod(
                    datapath=dp,
                    cookie=int(body["cookie"]),
                    cookie_mask=0 if block else 0xFFFFFFFFFFFFFFFF,
                    table_id=0,
                    command=ofp.OFPFC_ADD if block else ofp.OFPFC_DELETE_STRICT,
                    priority=50000,
                    hard_timeout=300 if block else 0,
                    out_port=ofp.OFPP_ANY,
                    out_group=ofp.OFPG_ANY,
                    match=parser.OFPMatch(**fields),
                    instructions=[],
                )
                api.send_msg(self, message)
                api.send_msg(self, parser.OFPBarrierRequest(dp), reply_cls=parser.OFPBarrierReply)
                result = {"ok": True}
            else:
                start_response("404 Not Found", [("Content-Type", "application/json")])
                return [b'{"detail":"Unknown controller endpoint"}']
            content = json.dumps(result).encode()
            start_response(
                "200 OK", [("Content-Type", "application/json"), ("Content-Length", str(len(content)))]
            )
            return [content]
        except Exception:
            self.logger.exception("Controller REST request failed")
            start_response("400 Bad Request", [("Content-Type", "application/json")])
            return [b'{"detail":"Controller request failed"}']

    @set_ev_cls(ofp_event.EventOFPSwitchFeatures, CONFIG_DISPATCHER)
    def features(self, event):
        datapath = event.msg.datapath
        parser, ofp = datapath.ofproto_parser, datapath.ofproto
        actions = [parser.OFPActionOutput(ofp.OFPP_CONTROLLER, ofp.OFPCML_NO_BUFFER)]
        self.add_flow(datapath, 0, parser.OFPMatch(), actions)

    def add_flow(self, datapath, priority, match, actions):
        parser, ofp = datapath.ofproto_parser, datapath.ofproto
        instructions = [parser.OFPInstructionActions(ofp.OFPIT_APPLY_ACTIONS, actions)]
        datapath.send_msg(
            parser.OFPFlowMod(
                datapath=datapath,
                priority=priority,
                match=match,
                instructions=instructions,
                idle_timeout=30 if priority else 0,
            )
        )

    @set_ev_cls(ofp_event.EventOFPPacketIn, MAIN_DISPATCHER)
    def packet_in(self, event):
        msg = event.msg
        datapath = msg.datapath
        parser, ofp = datapath.ofproto_parser, datapath.ofproto
        in_port = msg.match["in_port"]
        pkt = packet.Packet(msg.data)
        eth = pkt.get_protocol(ethernet.ethernet)
        if not eth or eth.ethertype == ether_types.ETH_TYPE_LLDP:
            return
        table = self.mac_to_port.setdefault(datapath.id, {})
        table[eth.src] = in_port
        out_port = table.get(eth.dst, ofp.OFPP_FLOOD)
        actions = [parser.OFPActionOutput(out_port)]
        ip = pkt.get_protocol(ipv4.ipv4)
        # Do not install broad L2 rules that hide later IPv4 flow identities.
        if out_port != ofp.OFPP_FLOOD and ip and ip.proto in (1, 6, 17):
            fields = {
                "in_port": in_port,
                "eth_type": 2048,
                "ipv4_src": ip.src,
                "ipv4_dst": ip.dst,
                "ip_proto": ip.proto,
            }
            transport = pkt.get_protocol(tcp.tcp) if ip.proto == 6 else pkt.get_protocol(udp.udp)
            if transport and ip.proto in (6, 17):
                fields["tcp_dst" if ip.proto == 6 else "udp_dst"] = transport.dst_port
            self.add_flow(datapath, 100, parser.OFPMatch(**fields), actions)
        datapath.send_msg(
            parser.OFPPacketOut(
                datapath=datapath,
                buffer_id=msg.buffer_id,
                in_port=in_port,
                actions=actions,
                data=msg.data if msg.buffer_id == ofp.OFP_NO_BUFFER else None,
            )
        )
