# Detection Lab reviewer walkthrough

Start from the repository root with `npm run local:up`, then open
[Detection Lab](http://localhost:5180/lab). The benchmark ships with the
API image. Initial image builds require internet; running the benchmark
uses the local model and bundled dataset partition.

## Evaluate the detector

1. Select **Run benchmark**. The FastAPI service applies the verified
   Extra Trees classifier to the 4,050 published test windows.
2. Check the reference results at the configured 0.525 threshold.

   | Published label | Flagged | Benign |
   | --- | ---: | ---: |
   | Attack | 1,428 | 257 |
   | Benign | 52 | 2,313 |

   Expected attack precision is **96.49%** and attack recall is **84.75%**.
   The false-positive rate is **2.20%**. Timing is measured around model
   inference alone and varies by machine.
3. Select **False negative**. Open the first row to see an attack-labeled
   TCP window close to the threshold. Export the selected outcome to CSV.
   The export should contain 257 data rows, with scores below 0.525,
   published label 1, and outcome `fn`.
4. Move the threshold below the current value and compare the matrix.
   **Reset** restores the reference result. The slider and protocol
   filter operate in the current browser and do not update detector settings.
5. Expand **Run provenance** to record the exact model version, model and
   dataset checksums, and run identifier.

The API call is `POST /api/benchmark/run`. It uses a fixed local partition and
shares the detector's scoring method with live ingestion. The run produces
no workspace records. OpenFlow observations arrive on a separate
authenticated endpoint and are delivered to the console over WebSocket.

## Observe fresh SDN telemetry

Sign up or sign in, open **Network setup**, and choose **Start my live lab**.
The managed host needs to be online. Allow roughly 60–90 seconds for discovery
and the first flow window. In **Live traffic**, select **Inspect** to see the
stored verdict, attack score, model version, and the five measured inputs.
**Network topology** shows switches and links discovered by the controller.
Finish with **Stop lab**.

The live workload uses bounded ICMP and UDP in isolated namespaces. Attack
labels and detection-error counts come from recorded, published windows.
Original capture IDs are unavailable, so bidirectional endpoint/protocol
groups approximate independence. This benchmark has been examined during
development and its scores are uncalibrated. An independent network
evaluation requires fresh labels.

## Rebuild the benchmark partition

From `backend`, install `requirements.lock`, then run:

```sh
python -m ml.prepare_mendeley
python -m ml.prepare_benchmark data/windows.csv
pytest -q tests/test_benchmark.py
```

The extractor checks the prepared dataset against the model metadata
and uses the same disjoint split as training. It retains the original
prepared row number, five derived features, and publisher label.
Source: Nisha Ahuja, Gaurav Singal and Debajyoti Mukhopadhyay,
[DDOS attack SDN Dataset, version 1](https://data.mendeley.com/datasets/jxpfjc64kr/1),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
