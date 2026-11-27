export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/" || path === "/index.html" || path === "/academia" || path === "/mi-espacio" ||
        path === "/admin" || /^\/(?:api|admin|perfil|media)\//.test(path)) {
      if (!env.IVARTIST_API) return new Response("La conexión con el sitio todavía no está configurada.", { status: 503 });
      return env.IVARTIST_API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
