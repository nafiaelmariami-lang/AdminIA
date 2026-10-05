/**
 * Faux serveur S3 en mémoire (adressage par chemin) : PUT, GET, DELETE, ListObjectsV2 (prefix,
 * delimiter, pagination). Vérifie que chaque requête est signée en AWS SigV4.
 */
export function createFakeS3(bucket = "adminia-test", pageSize = 2) {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const requests: { method: string; path: string }[] = [];
  let unsigned = 0;

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    requests.push({ method: req.method, path: url.pathname });
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith("AWS4-HMAC-SHA256 Credential=") || !req.headers.get("x-amz-date") || !req.headers.get("x-amz-content-sha256")) {
      unsigned++;
      return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
    }
    const [, b, ...rest] = url.pathname.split("/");
    if (b !== bucket) return new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 });
    const key = rest.map(decodeURIComponent).join("/");
    if (req.method === "PUT") {
      objects.set(key, new Uint8Array(await req.arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (req.method === "GET" && key) {
      const o = objects.get(key);
      return o ? new Response(new Uint8Array(o), { status: 200 }) : new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    }
    if (req.method === "GET") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const delimiter = url.searchParams.get("delimiter");
      const start = Number(url.searchParams.get("continuation-token") ?? "0");
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      let items: string[];
      let tag: "Key" | "Prefix";
      if (delimiter) {
        items = [...new Set(keys.map((k) => prefix + k.slice(prefix.length).split(delimiter)[0] + delimiter))].sort();
        tag = "Prefix";
      } else {
        items = keys;
        tag = "Key";
      }
      const page = items.slice(start, start + pageSize);
      const truncated = start + pageSize < items.length;
      const body =
        tag === "Key"
          ? page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")
          : page.map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("");
      return new Response(
        `<?xml version="1.0"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>` : ""}${body}</ListBucketResult>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }
    return new Response(null, { status: 405 });
  };
  return { objects, requests, fetchImpl: fetchImpl as typeof fetch, unsignedCount: () => unsigned };
}
