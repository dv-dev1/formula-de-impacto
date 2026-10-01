const VERSAO = "dev";
const ARQUIVOS = ["/", "/entrevista/", "/relatorio/", "/consolidado/", "/aparelho/", "/manifest.webmanifest"];
const CACHE = `formula-de-impacto-${VERSAO}`;

self.addEventListener("install", (evento) => {
  evento.waitUntil((async () => {
    const chaves = await caches.keys();
    const cache = await caches.open(CACHE);
    const resultados = await Promise.allSettled(ARQUIVOS.map((url) => cache.add(url)));
    const falhou = resultados.some((r) => r.status === "rejected");
    const anterior = chaves.some((c) => c !== CACHE && c.startsWith("formula-de-impacto-"));
    // Uma atualização parcial não pode substituir o cache completo que já funciona em campo.
    if (falhou && anterior) {
      await caches.delete(CACHE);
      throw new Error("Não consegui guardar todos os arquivos da atualização.");
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

const guardar = (request, resposta) => {
  if (resposta?.ok) {
    const copia = resposta.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copia));
  }
  return resposta;
};

self.addEventListener("fetch", (evento) => {
  const { request } = evento;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Nome com hash nunca muda de conteúdo.
  if (request.url.includes("/_next/static/")) {
    evento.respondWith(
      caches.match(request).then((achado) => achado ?? fetch(request).then((r) => guardar(request, r))),
    );
    return;
  }

  // Rede primeiro: cache-first no HTML servia o app shell antigo para sempre, e o aparelho
  // em campo nunca receberia correção. O cache responde quando não há sinal.
  evento.respondWith(
    fetch(request)
      .catch(() =>
        caches
          .match(request, { ignoreSearch: true })
          .then((achado) => (achado && new Response(achado.body, achado)) ?? (request.mode === "navigate" ? caches.match("/") : undefined)),
      ),
  );
});
