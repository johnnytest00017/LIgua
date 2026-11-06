// Safina: Library add-menu interaction
(() => {
  const sheet = document.getElementById("safina-add-sheet");
  const openBtn = document.getElementById("safina-add");
  const closeBtn = document.getElementById("safina-add-close");
  const cancelBtn = document.getElementById("safina-import-cancel");
  const reviewBtn = document.getElementById("safina-import-review");
  const titleEl = document.getElementById("safina-import-title");
  const typeEl = document.getElementById("safina-import-type");
  const filesEl = document.getElementById("safina-import-files");
  const tree = document.getElementById("safina-tree");
  const status = document.getElementById("safina-status");
  if (!sheet || !openBtn || !closeBtn || !filesEl || !tree) return;

  const esc = v => String(v).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const base = name => name.replace(/\\/g,"/").split("/").pop();
  const stem = name => base(name).replace(/\.[^.]+$/,"").toLowerCase();
  const episodeInfo = name => {
    const n = name.replace(/\\/g, "/").split("/").pop();

    const patterns = [
      /(?:^|[\s._()[\]-])s\s*(\d{1,2})\s*[-_. ]*e(?:p(?:isode)?)?\s*(\d{1,3})(?!\d)/i,
      /(?:^|[\s._()[\]-])season\s*(\d{1,2})\s*(?:episode|ep)\s*\.?\s*(\d{1,3})(?!\d)/i,
      /(?:^|[\s._()[\]-])(\d{1,2})\s*x\s*(\d{1,3})(?!\d)/i,
      /(?:^|[\s._()[\]-])(\d{1,2})(?:st|nd|rd|th)?\s+season\s+(?:episode|ep)\s*\.?\s*(\d{1,3})(?!\d)/i
    ];

    for (const re of patterns) {
      const m = n.match(re);
      if (m) return {
        season: Number(m[1]),
        episode: Number(m[2]),
        certain: true
      };
    }

    const ep = n.match(
      /(?:^|[\s._()[\]-])(?:episode|episodes|ep)\s*\.?\s*(\d{1,3})(?!\d)/i
    );

    if (ep) return {
      season: null,
      episode: Number(ep[1]),
      certain: false
    };

    return null;
  };

  const seasonOf = name => {
    const info = episodeInfo(name);
    if (!info) return "Season — needs review";
    if (!info.certain) return "Season — needs review";
    return "Season " + String(info.season).padStart(2, "0");
  };

  function close(){ sheet.classList.remove("open"); }
  openBtn.addEventListener("click", () => sheet.classList.add("open"));
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  sheet.addEventListener("click", e => { if(e.target === sheet) close(); });
  document.addEventListener("keydown", e => { if(e.key === "Escape") close(); });

  // Manual import corrections persist across preview refreshes.
  const manualEdits = new Map();
  function editFor(file) {
    if (!manualEdits.has(file.name)) {
      const info = episodeInfo(file.name);
      manualEdits.set(file.name, {
        name: file.name,
        season: info && info.certain ? String(info.season) : "",
        episode: info ? String(info.episode) : "",
        subtitle: ""
      });
    }
    return manualEdits.get(file.name);
  }

  function preview(){
    const files = Array.from(filesEl.files || []);
    const title = titleEl.value.trim() || "Untitled";
    const type = typeEl.value;
    tree.innerHTML = "";
    if(!files.length){
      status.textContent = "Choose files to prepare a preview.";
      return;
    }

    const groups = new Map();
    const warnings = [];
    const add = (folder, label) => {
      if(!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(label);
    };
    const videos = files.filter(f => /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.name));
    const subtitles = files.filter(f => /\.(srt|vtt)$/i.test(f.name));
    const images = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name));
    const descriptions = files.filter(f => /\.txt$/i.test(f.name));
    const docs = files.filter(f => /\.(pdf|epub)$/i.test(f.name));
    const comics = files.filter(f => /\.(cbz|cbr|zip)$/i.test(f.name));
    const usedSubs = new Set();
    const usedImages = new Set();
    const usedDescriptions = new Set();

    const root = type === "movie" ? "Movies/" + title :
      type === "tv" ? "TV Shows/" + title :
      type === "book" ? "Books/" + title : "Comics/" + title;

    if(type === "movie" || type === "tv"){
      if (type === "tv") {
        const seenEpisodes = new Map();
        videos.forEach(v => {
          const edit = editFor(v);
          const detected = episodeInfo(v.name);
          const season = edit.season === "" ? null : Number(edit.season);
          const episode = edit.episode === "" ? null : Number(edit.episode);
          const info = season !== null && episode !== null
            ? {season, episode, certain:true}
            : detected;
          if (!info) return;
          const key = info.certain
            ? info.season + ":" + info.episode
            : "unknown:" + info.episode;
          if (seenEpisodes.has(key)) {
            warnings.push(
              "Possible duplicate episode: " + seenEpisodes.get(key) +
              " and " + v.name
            );
          } else {
            seenEpisodes.set(key, v.name);
          }
        });
      }

      const orderedVideos = [...videos].sort((a, b) => {
        const ea = editFor(a), eb = editFor(b);
        const x = type === "tv" && ea.season !== "" && ea.episode !== ""
          ? {season:Number(ea.season), episode:Number(ea.episode), certain:true}
          : episodeInfo(a.name);
        const y = type === "tv" && eb.season !== "" && eb.episode !== ""
          ? {season:Number(eb.season), episode:Number(eb.episode), certain:true}
          : episodeInfo(b.name);
        if (!x && !y) return a.name.localeCompare(b.name);
        if (!x) return 1;
        if (!y) return -1;
        return ((x.season ?? 999) - (y.season ?? 999)) ||
               ((x.episode ?? 999) - (y.episode ?? 999)) ||
               a.name.localeCompare(b.name);
      });

      orderedVideos.forEach(v => {
        const detected = episodeInfo(v.name);
        const edit = editFor(v);
        const info = type === "tv" ? {
          season: edit.season === "" ? null : Number(edit.season),
          episode: edit.episode === "" ? null : Number(edit.episode),
          certain: edit.season !== "" && edit.episode !== ""
        } : detected;
        const correctedSeason = info && info.certain
          ? "Season " + String(info.season).padStart(2, "0")
          : "Season — needs review";
        const folder = type === "tv" ? root + "/" + correctedSeason : root;
        let label = "🎞️ " + (edit.name || v.name);

        if (type === "tv") {
          if (!info) {
            label = "⚠️ Unidentified episode: " + v.name;
            warnings.push("Could not identify episode number: " + v.name);
          } else if (!info.certain) {
            label = "⚠️ Episode " + String(info.episode).padStart(2, "0") +
                    " — season needs confirmation: " + v.name;
            warnings.push("Confirm the season for: " + v.name);
          } else {
            label = "🎞️ Episode " + String(info.episode).padStart(2, "0") +
                    ": " + v.name;
          }
        }

        add(folder, label);
        const videoStem = stem(v.name);
        const infoForVideo = info;
        let match = edit.subtitle && edit.subtitle !== "__none__"
          ? subtitles.find(sub => sub.name === edit.subtitle && !usedSubs.has(sub))
          : null;

        // First try an exact filename-stem match when no manual choice exists.
        if (!match && !edit.subtitle) match = subtitles.find(sub =>
          !usedSubs.has(sub) && stem(sub.name) === videoStem
        );

        // Otherwise match by season and episode, ignoring release tags
        // such as 1080p, WEB-DL, language tags, and codec names.
        if (!match && !edit.subtitle && infoForVideo && infoForVideo.certain) {
          const candidates = subtitles.filter(sub => {
            if (usedSubs.has(sub)) return false;
            const subInfo = episodeInfo(sub.name);
            return subInfo && subInfo.certain &&
              subInfo.season === infoForVideo.season &&
              subInfo.episode === infoForVideo.episode;
          });

          if (candidates.length === 1) {
            match = candidates[0];
          } else if (candidates.length > 1) {
            warnings.push("Multiple possible subtitles for " + v.name +
              ": " + candidates.map(x => x.name).join(", "));
          }
        }

        if (edit.subtitle && edit.subtitle !== "__none__" && !match) {
          warnings.push("Selected subtitle is unavailable or already assigned: " +
                        edit.subtitle + " (" + v.name + ")");
        }
        if (match) {
          add(folder, "💬 " + match.name);
          usedSubs.add(match);
        } else if (edit.subtitle !== "__none__") {
          warnings.push("No unique matching subtitle found for " + v.name);
        }
      });
      subtitles.filter(f => !usedSubs.has(f)).forEach(f => {
        add(root, "⚠️ Unmatched subtitle: " + f.name);
        warnings.push("Subtitle needs matching: " + f.name);
      });
    }

    images.forEach(f => {
      const isCover = /cover|poster|folder|thumb|artwork/i.test(f.name);
      add(root, (isCover ? "🖼️ Cover: " : "🖼️ Image: ") + f.name);
      if(isCover) usedImages.add(f);
    });
    descriptions.forEach(f => {
      add(root, "📝 Description: " + f.name);
      usedDescriptions.add(f);
    });

    if(type === "book"){
      docs.forEach(f => add(root, "📚 " + f.name));
      if(!docs.length) warnings.push("No PDF or EPUB book file selected.");
    }
    if(type === "comic"){
      comics.forEach(f => add(root, "🗯️ " + f.name));
      images.filter(f => !usedImages.has(f)).forEach(f => add(root, "🖼️ Comic image: " + f.name));
      if(!comics.length && !images.length) warnings.push("No comic archive or comic images selected.");
    }
    if((type === "movie" || type === "tv") && !videos.length)
      warnings.push("No video files selected.");
    if(!images.length) warnings.push("No cover artwork selected.");
    if(!descriptions.length) warnings.push("No .txt description selected.");

    let out = '<details open><summary>📁 ' + esc(root) + '</summary><ul>';
    for(const [folder, items] of groups){
      if(folder === root){
        items.forEach(item => out += "<li>" + esc(item) + "</li>");
      } else {
        out += '<li><details open><summary>📁 ' + esc(folder.slice(root.length+1)) + '</summary><ul>';
        items.forEach(item => out += "<li>" + esc(item) + "</li>");
        out += "</ul></details></li>";
      }
    }
    out += "</ul></details>";
    if(warnings.length){
      out += '<p class="safina-import-warning">⚠️ Check these items:</p><ul>';
      warnings.forEach(w => out += "<li class=\"safina-import-warning\">" + esc(w) + "</li>");
      out += "</ul>";
    }
    if (type === "tv" && videos.length) {
      out += '<hr><h3>✏️ Manual episode corrections</h3>';
      out += '<p class="mu">Change season or episode numbers when detection is wrong. Leave season blank if unknown.</p>';
      videos.forEach((v, index) => {
        const edit = editFor(v);
        out += '<div class="safina-edit-row" style="border:1px solid #40536a;border-radius:10px;padding:10px;margin:8px 0">';
        out += '<label>Video filename</label><input data-edit-name="' + esc(v.name) + '" value="' + esc(edit.name) + '">';
        out += '<div style="display:flex;gap:8px;margin-top:8px">';
        out += '<div style="flex:1"><label>Season</label><input type="number" min="1" max="99" data-edit-season="' + esc(v.name) + '" value="' + esc(edit.season) + '" placeholder="Unknown"></div>';
        out += '<div style="flex:1"><label>Episode</label><input type="number" min="1" max="999" data-edit-episode="' + esc(v.name) + '" value="' + esc(edit.episode) + '" placeholder="Unknown"></div></div>';
        out += '<label style="display:block;margin-top:8px">Subtitle</label><select data-edit-subtitle="' + esc(v.name) + '"><option value="">Automatic match</option><option value="__none__">No subtitle</option>';
        subtitles.forEach(sub => {
          out += '<option value="' + esc(sub.name) + '"' + (edit.subtitle === sub.name ? ' selected' : '') + '>' + esc(sub.name) + '</option>';
        });
        out += '</select></div>';
      });
    }

    tree.innerHTML = out;

    tree.querySelectorAll("[data-edit-name]").forEach(el => el.addEventListener("change", () => {
      editFor({name:el.dataset.editName}).name = el.value.trim() || el.dataset.editName;
    }));
    tree.querySelectorAll("[data-edit-season]").forEach(el => el.addEventListener("change", () => {
      editFor({name:el.dataset.editSeason}).season = el.value;
      preview();
    }));
    tree.querySelectorAll("[data-edit-episode]").forEach(el => el.addEventListener("change", () => {
      editFor({name:el.dataset.editEpisode}).episode = el.value;
      preview();
    }));
    tree.querySelectorAll("[data-edit-subtitle]").forEach(el => el.addEventListener("change", () => {
      const edit = editFor({name:el.dataset.editSubtitle});
      edit.subtitle = el.value === "__none__" ? "__none__" : el.value;
      preview();
    }));

    status.textContent = files.length + " file(s) selected. Review and correct the proposed folders below.";
  }

  [titleEl,typeEl,filesEl].forEach(el => el.addEventListener("change", preview));
  titleEl.addEventListener("input", preview);
  reviewBtn.addEventListener("click", () => {
    preview();
    status.textContent = "Preview ready. No files have been copied yet; private-storage import is the next step.";
  });
})();
