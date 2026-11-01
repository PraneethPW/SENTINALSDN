#!/bin/sh
set -eu
mkdir -p /var/run/openvswitch /var/log/openvswitch /etc/openvswitch
[ -f /etc/openvswitch/conf.db ] || ovsdb-tool create /etc/openvswitch/conf.db /usr/share/openvswitch/vswitch.ovsschema
ovsdb-server --remote=punix:/var/run/openvswitch/db.sock --pidfile --overwrite-pidfile --detach
ovs-vsctl --no-wait init
ovs-vswitchd --pidfile --overwrite-pidfile --detach --log-file
/opt/controller/bin/osken-manager --observe-links --ofp-tcp-listen-port 6653 collector/sentinel_switch.py > /tmp/controller.log 2>&1 &
controller_pid=$!
sleep 4
/opt/controller/bin/python -m collector.agent > /tmp/collector.log 2>&1 &
collector_pid=$!
/usr/bin/python3 lab/network.py > /tmp/network.log 2>&1 &
network_pid=$!
trap 'kill "$network_pid" "$collector_pid" "$controller_pid" 2>/dev/null || true; wait' INT TERM EXIT
while kill -0 "$controller_pid" && kill -0 "$collector_pid" && kill -0 "$network_pid"; do sleep 3; done
exit 1
