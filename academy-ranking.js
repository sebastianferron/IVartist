(() => {
  "use strict";
  const section = document.querySelector("[data-ranking]");
  if (!section) return;
  const list = section.querySelector(".ranking-list");
  const sample = section.querySelector(".ranking-sample");
  const error = section.querySelector(".ranking-error");
  const { request } = window.academyPayment;
  const { setAvatar } = window.communityProfile;
  let signature;
  let loading = false;
  let queued = false;
  function render(participants, examples) {
    const demonstration = participants.length === 0;
    const entries = demonstration ? examples : participants;
    sample.hidden = !demonstration;
    list.dataset.size = entries.length;
    list.replaceChildren(...entries.map(({ rank, name, avatar, url, points }) => {
      const item = document.createElement("li");
      item.className = "ranking-card";
      item.dataset.rank = rank;
      const position = document.createElement("span");
      position.className = "ranking-position";
      position.textContent = rank;
      position.setAttribute("aria-label", `Puesto ${rank}`);
      const image = document.createElement(demonstration ? "span" : "img");
      image.className = "profile-avatar ranking-avatar";
      if (demonstration) {
        image.classList.add("ranking-initials");
        image.textContent = name.split(" ").map((word) => word[0]).join("");
        image.setAttribute("aria-hidden", "true");
      } else {
        image.alt = "";
        image.loading = "lazy";
        setAvatar(image, avatar);
      }
      const participant = document.createElement("strong");
      participant.className = "ranking-name";
      participant.textContent = name;
      const profile = document.createElement(url ? "a" : "div");
      profile.className = "ranking-profile";
      if (url) {
        profile.href = url;
        profile.setAttribute("aria-label", `Ver perfil de ${name}`);
      }
      const total = document.createElement("span");
      total.className = "ranking-score";
      total.textContent = `${points} ${points === 1 ? "punto" : "puntos"}`;
      profile.append(position, image, participant, total);
      item.append(profile);
      return item;
    }));
  }

  async function refresh() {
    if (loading) { queued = true; return; }
    loading = true;
    try {
      const { participants, examples = [] } = await request("/ranking");
      const current = JSON.stringify([participants, examples]);
      if (current !== signature) {
        render(participants, examples);
        signature = current;
      }
      error.textContent = "";
    } catch {
      if (signature === undefined) error.textContent = "No pudimos cargar el podio. Vuelve a intentarlo al regresar.";
    } finally {
      loading = false;
      if (queued) { queued = false; refresh(); }
    }
  }

  window.academyRanking = { refresh };
  window.addEventListener("focus", refresh);
  window.setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
  refresh();
})();
