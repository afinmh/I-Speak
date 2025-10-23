export function json(data, init = 200) {
  const status = typeof init === "number" ? init : init?.status ?? 200;
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export function error(message, status = 400, extra) {
  return json({ error: message, ...extra }, status);
}
