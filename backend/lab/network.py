"""Real namespace-isolated Mininet traffic. No route from lab hosts to the internet."""

import signal
import time

from mininet.net import Mininet
from mininet.node import OVSSwitch, RemoteController
from mininet.log import setLogLevel

setLogLevel("info")
net = Mininet(controller=None, switch=OVSSwitch, build=False)
net.addController("c0", controller=RemoteController, ip="127.0.0.1", port=6653)
switches = [
    net.addSwitch(f"s{i}", protocols="OpenFlow13", datapath="user", failMode="secure") for i in range(1, 4)
]
net.addLink(switches[0], switches[1])
net.addLink(switches[1], switches[2])
hosts = [net.addHost(f"h{i}", ip=f"10.77.0.{i}/24") for i in range(1, 4)]
for host, switch in zip(hosts, switches):
    net.addLink(host, switch)


def stop(*args):
    net.stop()
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    net.build()
    net.start()
    time.sleep(4)
    # Userspace OVS needs software checksums on namespace veths for TCP/UDP.
    for host in hosts:
        host.cmd(f"ethtool -K {host.name}-eth0 tx off rx off tso off gso off gro off")
    for switch in switches:
        for interface in switch.intfNames():
            if interface != "lo":
                switch.cmd(f"ethtool -K {interface} tx off rx off tso off gso off gro off")
    # Low-rate ICMP and 64 Kbit/s UDP traffic: actual packets, never a fabricated feed.
    for port in (5201, 5202):
        hosts[2].cmd(f"iperf3 -s -4 -p {port} > /tmp/iperf-server-{port}.log 2>&1 &")
    time.sleep(1)
    for index, host in enumerate(hosts[:2]):
        host.cmd("ping -i 1 10.77.0.3 > /tmp/ping.log 2>&1 &")
        host.cmd(
            f"while true; do iperf3 -c 10.77.0.3 -4 -p {5201 + index} -u -b 64K -l 512 -t 3600; sleep 2; done > /tmp/iperf-client-{index}.log 2>&1 &"
        )
    print("Isolated SDN lab running: 3 OpenFlow switches, 3 hosts, ICMP and bounded UDP.", flush=True)
    while True:
        time.sleep(10)
finally:
    net.stop()
