#!/bin/sh
set -eu
mkdir -p /var/run/openvswitch /var/log/openvswitch /etc/openvswitch
ovsdb-tool create /etc/openvswitch/conf.db /usr/share/openvswitch/vswitch.ovsschema
ovsdb-server --remote=punix:/var/run/openvswitch/db.sock --pidfile --detach
ovs-vsctl --no-wait init
ovs-vswitchd --pidfile --detach --log-file
/opt/controller/bin/osken-manager --ofp-tcp-listen-port 6653 collector/sentinel_switch.py > /tmp/controller.log 2>&1 &
sleep 4
/opt/controller/bin/python -m collector.agent > /tmp/collector.log 2>&1 &
exec /usr/bin/python3 lab/network.py
