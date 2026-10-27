FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    mininet openvswitch-switch iperf3 python3 python3-venv iproute2 iputils-ping procps ca-certificates ethtool \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/controller && /opt/controller/bin/pip install --no-cache-dir \
    os-ken==2.11.2 eventlet==0.40.3 httpx==0.28.1 setuptools==80.9.0
WORKDIR /opt/sentinel
COPY collector ./collector
COPY lab/start.sh lab/network.py ./lab/
RUN chmod +x lab/start.sh
ENTRYPOINT ["/opt/sentinel/lab/start.sh"]
