import asyncio
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb

from app.config import settings
from app.db import db
from app.detector import detector, features
from app.schemas import Batch, CommandResult
from app.security import collector_auth

router = APIRouter(prefix="/api/collector", dependencies=[Depends(collector_auth)])


@router.post("/batches")
async def ingest(batch: Batch):
    if any(flow.switch_id not in batch.switches for flow in batch.flows):
        raise HTTPException(422, "All flows must belong to a reported switch")
    predictions = await asyncio.to_thread(detector.predict, batch.flows)
    version = detector.metadata["version"] if detector.metadata else None
    async with db.connection() as conn:
        await conn.execute(
            """INSERT INTO collectors(id,last_seen,switches,controller_status,version,topology)
            VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET last_seen=EXCLUDED.last_seen,
            switches=EXCLUDED.switches,controller_status=EXCLUDED.controller_status,version=EXCLUDED.version,topology=EXCLUDED.topology
            WHERE EXCLUDED.last_seen>=collectors.last_seen""",
            (
                batch.collector_id,
                batch.captured_at,
                Jsonb(batch.switches),
                batch.controller_status,
                batch.version,
                Jsonb(batch.topology.model_dump(mode="json")),
            ),
        )
        inserted = await conn.execute(
            "INSERT INTO batches(id,collector_id) VALUES (%s,%s) ON CONFLICT DO NOTHING RETURNING id",
            (batch.batch_id, batch.collector_id),
        )
        if not await inserted.fetchone():
            return {"accepted": 0, "duplicate": True}
        # Serialize incident grouping per collector across replicas.
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (batch.collector_id,))
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
                )
            )
        if values:
            async with conn.cursor() as cursor:
                await cursor.executemany(
                    """INSERT INTO flows(batch_id,collector_id,observed_at,switch_id,
                source_ip,destination_ip,protocol,destination_port,packets,bytes,interval_seconds,
                duration_seconds,packet_rate,byte_rate,prediction,attack_probability,model_version)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    values,
                )
        for flow, (prediction, probability) in zip(batch.flows, predictions):
            if prediction != "attack" or flow.packets < settings().minimum_attack_packets:
                continue
            existing = await conn.execute(
                """SELECT id FROM incidents WHERE collector_id=%s AND switch_id=%s
                AND source_ip=%s AND destination_ip=%s AND protocol=%s AND destination_port IS NOT DISTINCT FROM %s
                AND last_seen>now()-interval '2 minutes' AND status != 'resolved' ORDER BY last_seen DESC LIMIT 1""",
                (
                    batch.collector_id,
                    flow.switch_id,
                    str(flow.source_ip),
                    str(flow.destination_ip),
                    flow.protocol,
                    flow.destination_port,
                ),
            )
            incident = await existing.fetchone()
            if incident:
                await conn.execute(
                    """UPDATE incidents SET last_seen=GREATEST(last_seen,%s),
                    probability=GREATEST(probability,%s),packets=packets+%s,bytes=bytes+%s WHERE id=%s""",
                    (flow.observed_at, probability, flow.packets, flow.bytes, incident["id"]),
                )
            else:
                incident_id = uuid4()
                await conn.execute(
                    """INSERT INTO incidents(id,collector_id,switch_id,source_ip,destination_ip,
                    protocol,destination_port,first_seen,last_seen,probability,packets,bytes,model_version)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
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
                    ),
                )
                await db.audit(
                    conn, batch.collector_id, "incident.detected", incident_id, {"model_version": version}
                )
    return {"accepted": len(batch.flows), "duplicate": False}


@router.get("/{collector_id}/commands")
async def commands(collector_id: str):
    async with db.connection() as conn:
        await conn.execute(
            "UPDATE commands SET status='expired' WHERE status='enforced' AND expires_at<=now()"
        )
        # At-least-once command delivery; deterministic cookies make retries idempotent.
        result = await conn.execute(
            """UPDATE commands SET status='dispatched',lease_until=now()+interval '30 seconds'
            WHERE id IN (SELECT id FROM commands WHERE collector_id=%s AND
              (status='queued' OR (status='dispatched' AND lease_until<now()))
              ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED)
            RETURNING id,kind,cookie,payload,created_at""",
            (collector_id,),
        )
        return await result.fetchall()


@router.post("/{collector_id}/commands/{command_id}/result")
async def command_result(collector_id: str, command_id: str, result: CommandResult):
    async with db.connection() as conn:
        cursor = await conn.execute(
            "SELECT * FROM commands WHERE id=%s AND collector_id=%s FOR UPDATE", (command_id, collector_id)
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
                "UPDATE commands SET status='revoked' WHERE cookie=%s AND kind='block' AND status='enforced'",
                (command["cookie"],),
            )
        await db.audit(
            conn, collector_id, f"mitigation.{result.status}", command_id, {"detail": result.detail}
        )
    return {"status": result.status}
