"""Real namespace-isolated Mininet traffic. No route from lab hosts to the internet."""

import signal
import time

from mininet.net import Mininet
from mininet.node import OVSSwitch, RemoteController
from mininet.log import setLogLevel

setLogLevel("info")
net = Mininet(controller=None, switch=OVSSwitch, build=False)
net.addController("c0", controller=RemoteController, ip="127.0.0.1", port=6653)
switch = net.addSwitch("s1", protocols="OpenFlow13", datapath="user", failMode="secure")
hosts = [net.addHost(f"h{i}", ip=f"10.77.0.{i}/24") for i in range(1, 4)]
for host in hosts:
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
    for port in range(1, 4):
        switch.cmd(f"ethtool -K s1-eth{port} tx off rx off tso off gso off gro off")
    # Low-rate ICMP and 64 Kbit/s UDP traffic: actual packets, never a fabricated feed.
    for port in (5201, 5202):
        hosts[2].cmd(f"iperf3 -s -4 -p {port} > /tmp/iperf-server-{port}.log 2>&1 &")
    time.sleep(1)
    for index, host in enumerate(hosts[:2]):
        host.cmd("ping -i 1 10.77.0.3 > /tmp/ping.log 2>&1 &")
        host.cmd(
            f"iperf3 -c 10.77.0.3 -4 -p {5201 + index} -u -b 64K -l 512 -t 86400 > /tmp/iperf-client-{index}.log 2>&1 &"
        )
    print("Isolated SDN lab running: 1 OpenFlow switch, 3 hosts, ICMP and bounded UDP.", flush=True)
    while True:
        time.sleep(10)
finally:
    net.stop()
