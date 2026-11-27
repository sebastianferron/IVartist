(() => {
  "use strict";

  const placeholder = "/assets/avatar-generico.svg";

  function setAvatar(image, source) {
    image.onerror = source ? () => {
      image.onerror = null;
      image.src = placeholder;
    } : null;
    image.src = source || placeholder;
  }

  function socialLinks(socials = [], showHandles = false) {
    const links = document.createElement("ul");
    links.className = "profile-socials";
    for (const { label, handle, href } of socials) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = showHandles ? `${label} · @${handle}` : label;
      link.setAttribute("aria-label", `${label} · @${handle}`);
      item.append(link);
      links.append(item);
    }
    return links;
  }

  window.communityProfile = { setAvatar, socialLinks };

  const content = document.querySelector("#public-profile-content");
  if (!content) return;
  const status = document.querySelector("#public-profile-status");
  async function loadProfile() {
    try {
      const response = await fetch(`/api/academy/profiles/${location.pathname.split("/").at(-1)}`);
      if (!response.ok) {
        status.textContent = response.status === 404 ? "Perfil no disponible." : "No se pudo cargar el perfil.";
        return;
      }
      const { profile } = await response.json();
      const name = profile.displayName || profile.name;
      document.title = `${name} · Ivanna Saldaña`;
      document.querySelector("#public-profile-name").textContent = name;
      document.querySelector("#public-profile-example").hidden = !profile.demo;
      const specialty = document.querySelector("#public-profile-specialty");
      specialty.textContent = profile.specialty || "";
      specialty.hidden = !profile.specialty;
      setAvatar(document.querySelector("#public-profile-avatar"), profile.avatar);
      if (profile.socials.length) document.querySelector("#public-profile-socials").replaceChildren(socialLinks(profile.socials, true));
      content.hidden = false;
      status.hidden = true;
    } catch {
      status.textContent = "No se pudo cargar el perfil.";
    }
  }
  loadProfile();
})();
