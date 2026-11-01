import asyncio
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb

from app.config import settings
from app.db import db
from app.detector import detector, features
from app.schemas import Batch, CommandResult
from app.security import collector_auth, check_collector

router = APIRouter(prefix="/api/collector")


@router.post("/batches")
async def ingest(batch: Batch, scope=Depends(collector_auth)):
    workspace_id = scope["workspace_id"]
    check_collector(scope, batch.collector_id)
    if any(flow.switch_id not in batch.switches for flow in batch.flows):
        raise HTTPException(422, "All flows must belong to a reported switch")
    predictions = await asyncio.to_thread(detector.predict, batch.flows)
    version = detector.metadata["version"] if detector.metadata else None
    source_type = "isolated_lab" if scope["lab_run_id"] else batch.source_type
    if (
        "source_type" not in batch.model_fields_set
        and str(workspace_id) == "00000000-0000-0000-0000-000000000001"
        and batch.collector_id in ("local-mininet-lab", "local-independent-lab")
    ):
        source_type = "isolated_lab"
    async with db.connection() as conn:
        if scope["lab_run_id"]:
            active = await (
                await conn.execute(
                    """SELECT id FROM managed_labs WHERE id=%s AND workspace_id=%s
                AND desired_state='running' AND expires_at>now() AND idle_expires_at>now() FOR UPDATE""",
                    (scope["lab_run_id"], workspace_id),
                )
            ).fetchone()
            if not active:
                raise HTTPException(401, "Lab session ended")
        await conn.execute(
            """INSERT INTO collectors(id,last_seen,switches,controller_status,version,topology,workspace_id,source_type,lab_run_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(workspace_id,id) DO UPDATE SET last_seen=EXCLUDED.last_seen,
            switches=EXCLUDED.switches,controller_status=EXCLUDED.controller_status,version=EXCLUDED.version,topology=EXCLUDED.topology,source_type=EXCLUDED.source_type
            WHERE EXCLUDED.last_seen>=collectors.last_seen AND collectors.lab_run_id IS NOT DISTINCT FROM EXCLUDED.lab_run_id""",
            (
                batch.collector_id,
                batch.captured_at,
                Jsonb(batch.switches),
                batch.controller_status,
                batch.version,
                Jsonb(batch.topology.model_dump(mode="json")),
                workspace_id,
                source_type,
                scope["lab_run_id"],
            ),
        )
        owner = await (
            await conn.execute(
                "SELECT lab_run_id FROM collectors WHERE workspace_id=%s AND id=%s",
                (workspace_id, batch.collector_id),
            )
        ).fetchone()
        if owner["lab_run_id"] != scope["lab_run_id"]:
            raise HTTPException(409, "Collector identifier belongs to a managed lab")
        inserted = await conn.execute(
            "INSERT INTO batches(id,collector_id,workspace_id) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id",
            (batch.batch_id, batch.collector_id, workspace_id),
        )
        if not await inserted.fetchone():
            original = await (
                await conn.execute(
                    "SELECT collector_id FROM batches WHERE id=%s AND workspace_id=%s",
                    (batch.batch_id, workspace_id),
                )
            ).fetchone()
            if not original or original["collector_id"] != batch.collector_id:
                raise HTTPException(409, "Batch identifier conflict; use a new batch identifier")
            return {"accepted": 0, "duplicate": True}
        # Serialize incident grouping per collector across replicas.
        await conn.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))", (str(workspace_id) + ":" + batch.collector_id,)
        )
        values = []
        for flow, (prediction, probability) in zip(batch.flows, predictions):
            packet_rate, byte_rate, *_ = features(flow)
            values.append(
                (
                    batch.batch_id,
                    batch.collector_id,
                    flow.observed_at,
                    flow.switch_id,
                    str(flow.source_ip),
                    str(flow.destination_ip),
                    flow.protocol,
                    flow.destination_port,
                    flow.packets,
                    flow.bytes,
                    flow.interval_seconds,
                    flow.duration_seconds,
                    packet_rate,
                    byte_rate,
                    prediction,
                    probability,
                    version,
                    workspace_id,
                )
            )
        if values:
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """INSERT INTO flows(batch_id,collector_id,observed_at,switch_id,
                source_ip,destination_ip,protocol,destination_port,packets,bytes,interval_seconds,
                duration_seconds,packet_rate,byte_rate,prediction,attack_probability,model_version,workspace_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    values,
                )
        for flow, (prediction, probability) in zip(batch.flows, predictions):
            if prediction != "attack" or flow.packets < settings().minimum_attack_packets:
                continue
            existing = await conn.execute(
                """SELECT id FROM incidents WHERE collector_id=%s AND switch_id=%s
                AND source_ip=%s AND destination_ip=%s AND protocol=%s AND destination_port IS NOT DISTINCT FROM %s
                AND workspace_id=%s AND last_seen>now()-interval '2 minutes' AND status != 'resolved' ORDER BY last_seen DESC LIMIT 1""",
                (
                    batch.collector_id,
                    flow.switch_id,
                    str(flow.source_ip),
                    str(flow.destination_ip),
                    flow.protocol,
                    flow.destination_port,
                    workspace_id,
                ),
            )
            incident = await existing.fetchone()
            if incident:
                await conn.execute(
                    """UPDATE incidents SET last_seen=GREATEST(last_seen,%s),
                    probability=GREATEST(probability,%s),packets=packets+%s,bytes=bytes+%s WHERE id=%s AND workspace_id=%s""",
                    (flow.observed_at, probability, flow.packets, flow.bytes, incident["id"], workspace_id),
                )
            else:
                incident_id = uuid4()
                await conn.execute(
                    """INSERT INTO incidents(id,collector_id,switch_id,source_ip,destination_ip,
                    protocol,destination_port,first_seen,last_seen,probability,packets,bytes,model_version,workspace_id)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        incident_id,
                        batch.collector_id,
                        flow.switch_id,
                        str(flow.source_ip),
                        str(flow.destination_ip),
                        flow.protocol,
                        flow.destination_port,
                        flow.observed_at,
                        flow.observed_at,
                        probability,
                        flow.packets,
                        flow.bytes,
                        version,
                        workspace_id,
                    ),
                )
                await db.audit(
                    conn,
                    batch.collector_id,
                    "incident.detected",
                    incident_id,
                    {"model_version": version},
                    workspace_id=workspace_id,
                )
        if scope["lab_run_id"]:
            phase = (
                "running"
                if batch.flows
                else ("awaiting_flows" if batch.controller_status == "connected" else "awaiting_controller")
            )
            await conn.execute(
                """UPDATE managed_labs SET state=CASE WHEN first_flow_at IS NOT NULL AND %s='awaiting_flows'
                THEN 'running' ELSE %s END,started_at=COALESCE(started_at,now()),
                controller_seen_at=CASE WHEN %s THEN COALESCE(controller_seen_at,%s) ELSE controller_seen_at END,
                first_flow_at=COALESCE(first_flow_at,%s),message='',updated_at=now() WHERE id=%s""",
                (
                    phase,
                    phase,
                    batch.controller_status == "connected",
                    batch.captured_at,
                    min((f.observed_at for f in batch.flows), default=None),
                    scope["lab_run_id"],
                ),
            )
    return {"accepted": len(batch.flows), "duplicate": False}


@router.get("/{collector_id}/commands")
async def commands(collector_id: str, scope=Depends(collector_auth)):
    workspace_id = scope["workspace_id"]
    check_collector(scope, collector_id)
    async with db.connection() as conn:
        await conn.execute(
            "UPDATE commands SET status='expired' WHERE workspace_id=%s AND status='enforced' AND expires_at<=now()",
            (workspace_id,),
        )
        # At-least-once command delivery; deterministic cookies make retries idempotent.
        result = await conn.execute(
            """UPDATE commands SET status='dispatched',lease_until=now()+interval '30 seconds'
            WHERE id IN (SELECT id FROM commands WHERE collector_id=%s AND workspace_id=%s AND
              (status='queued' OR (status='dispatched' AND lease_until<now()))
              ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED)
            RETURNING id,kind,cookie,payload,created_at""",
            (collector_id, workspace_id),
        )
        return await result.fetchall()


@router.post("/{collector_id}/commands/{command_id}/result")
async def command_result(
    collector_id: str, command_id: str, result: CommandResult, scope=Depends(collector_auth)
):
    workspace_id = scope["workspace_id"]
    check_collector(scope, collector_id)
    async with db.connection() as conn:
        cursor = await conn.execute(
            "SELECT * FROM commands WHERE id=%s AND collector_id=%s AND workspace_id=%s FOR UPDATE",
            (command_id, collector_id, workspace_id),
        )
        command = await cursor.fetchone()
        if not command:
            raise HTTPException(404, "Command not found")
        if command["status"] != "dispatched":
            return {"status": command["status"]}
        expected = "enforced" if command["kind"] == "block" else "revoked"
        if result.status not in (expected, "failed"):
            raise HTTPException(422, "Result does not match command kind")
        await conn.execute(
            """UPDATE commands SET status=%s,detail=%s,completed_at=now(),
            expires_at=CASE WHEN %s='enforced' THEN now()+interval '290 seconds' ELSE NULL END WHERE id=%s""",
            (result.status, result.detail, result.status, command_id),
        )
        if result.status == "revoked":
            await conn.execute(
                "UPDATE commands SET status='revoked' WHERE cookie=%s AND workspace_id=%s AND kind='block' AND status='enforced'",
                (command["cookie"], workspace_id),
            )
        await db.audit(
            conn,
            collector_id,
            f"mitigation.{result.status}",
            command_id,
            {"detail": result.detail},
            workspace_id=workspace_id,
        )
    return {"status": result.status}
