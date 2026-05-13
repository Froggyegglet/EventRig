let suppliers = window.EVENTRIG_SUPPLIERS || [];
let supplierSource = "local";
let supabaseClient = null;

const equipmentProfiles = {
  wedding: {
    title: "Elegant wedding rig",
    lighting: ["10-16 wireless uplights", "Warm room wash", "Dance floor lighting", "Optional moving heads"],
    audio: ["2 x 12-inch powered PA speakers", "1 x small mixer", "2 x wireless microphones", "Optional subwoofer"],
    base: [900, 1900],
  },
  party: {
    title: "Private party rig",
    lighting: ["4-8 party lights", "2 x compact moving heads", "Optional haze machine", "Colour wash for dance area"],
    audio: ["2 x powered PA speakers", "1 x 18-inch subwoofer", "Small mixer or DJ controller input", "1 x wireless microphone"],
    base: [650, 1500],
  },
  corporate: {
    title: "Corporate AV rig",
    lighting: ["Stage wash", "Brand colour uplights", "Speaker lectern lighting", "Optional logo projection"],
    audio: ["2-4 PA speakers", "2 x wireless microphones", "Mixer with laptop input", "Optional foldback monitor"],
    base: [1100, 2600],
  },
  dj: {
    title: "DJ performance rig",
    lighting: ["2-4 moving heads", "Dance floor wash", "Haze machine", "Optional laser alternative"],
    audio: ["2 x 12-inch PA speakers", "1-2 x 18-inch subwoofers", "DJ mixer/controller input", "Stage monitor"],
    base: [900, 2300],
  },
  stage: {
    title: "Small stage rig",
    lighting: ["Front stage wash", "Backlight or side wash", "2 x moving heads", "Simple lighting control"],
    audio: ["2-4 PA speakers", "Subwoofer as needed", "Mixer with 6-12 channels", "2 x stage monitors"],
    base: [1200, 3200],
  },
};

const venueMultipliers = {
  small: 0.82,
  medium: 1,
  large: 1.28,
  outdoor: 1.42,
};

const vibeAddons = {
  soft: {
    lighting: "Warm white or amber palette",
    audio: "Speech clarity priority",
    multiplier: 1,
  },
  club: {
    lighting: "Extra motion lighting for the dance floor",
    audio: "Subwoofer strongly recommended",
    multiplier: 1.18,
  },
  stage: {
    lighting: "Front wash plus backlight separation",
    audio: "Monitor mix for performers",
    multiplier: 1.2,
  },
  brand: {
    lighting: "Brand colour wash and clean presentation lighting",
    audio: "Wireless mics and laptop playback path",
    multiplier: 1.15,
  },
};

const form = document.querySelector("#advisorForm");
const resultTitle = document.querySelector("#resultTitle");
const resultSummary = document.querySelector("#resultSummary");
const lightingList = document.querySelector("#lightingList");
const audioList = document.querySelector("#audioList");
const budgetRange = document.querySelector("#budgetRange");
const supplierGrid = document.querySelector("#supplierGrid");
const quoteForm = document.querySelector("#quoteForm");
const quoteButton = document.querySelector("#quoteButton");
const quoteResult = document.querySelector("#quoteResult");
let currentMatches = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formValue(name) {
  return form.elements[name].value;
}

function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const config = window.EVENTRIG_SUPABASE;
  if (!window.supabase || !config?.url || !config?.anonKey) {
    return null;
  }

  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  return supabaseClient;
}

function formatSupplierType(type) {
  const labels = {
    hire: "Hire partner",
    retail: "Retail",
    production: "Production company",
    marketplace: "Marketplace",
  };

  return labels[type] || type || "Supplier";
}

function buildPriceLabel(products) {
  const priced = (products || [])
    .filter((product) => product.price_from !== null && product.price_from !== undefined)
    .sort((a, b) => Number(a.price_from) - Number(b.price_from));

  if (!priced.length) {
    return "quote-ready";
  }

  const product = priced[0];
  if (product.price_type === "range" && product.price_to) {
    return `${money(product.price_from)} - ${money(product.price_to)}`;
  }

  return `from ${money(product.price_from)}`;
}

function normalizeSupplier(row) {
  const products = row.supplier_products || [];
  const productCategories = products
    .map((product) => product.equipment_types?.name)
    .filter(Boolean);
  const categories = row.categories?.length ? row.categories : [...new Set(productCategories)].slice(0, 4);

  return {
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    type: formatSupplierType(row.supplier_type),
    price: buildPriceLabel(products),
    categories,
    fit: row.event_fit || [],
    email: row.email,
    website: row.website,
    verified: row.verified,
    paidPartner: row.paid_partner,
    products,
    summary: row.summary || "Local supplier matched by city, event type and equipment category.",
  };
}

async function loadSupabaseSuppliers() {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  const { data, error } = await client
    .from("suppliers")
    .select(`
      id,
      name,
      city,
      state,
      supplier_type,
      categories,
      event_fit,
      website,
      email,
      verified,
      paid_partner,
      priority_score,
      summary,
      supplier_products (
        id,
        product_name,
        brand,
        model,
        buy_or_hire,
        price_from,
        price_to,
        price_type,
        url,
        cities,
        equipment_types (
          slug,
          name,
          category
        )
      )
    `)
    .order("paid_partner", { ascending: false })
    .order("priority_score", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("Supabase supplier load failed. Falling back to local data.", error.message);
    return;
  }

  suppliers = (data || []).map(normalizeSupplier);
  supplierSource = "supabase";
  render();
}

function getRecommendation() {
  const city = formValue("city");
  const eventType = formValue("eventType");
  const venue = formValue("venue");
  const vibe = formValue("vibe");
  const guests = Number(formValue("guests"));
  const requestedBudget = Number(formValue("budget"));
  const profile = equipmentProfiles[eventType];
  const vibeProfile = vibeAddons[vibe];
  const guestMultiplier = guests > 250 ? 1.35 : guests > 150 ? 1.18 : guests < 60 ? 0.84 : 1;
  const multiplier = venueMultipliers[venue] * vibeProfile.multiplier * guestMultiplier;
  const low = Math.round((profile.base[0] * multiplier) / 50) * 50;
  const high = Math.round((profile.base[1] * multiplier) / 50) * 50;
  const budgetFit =
    requestedBudget >= high ? "Your budget can support a fuller package." :
    requestedBudget >= low ? "Your budget can support the core package." :
    "Keep the quote focused on essentials first.";

  return {
    city,
    eventType,
    guests,
    title: profile.title,
    lighting: [...profile.lighting, vibeProfile.lighting],
    audio: [...profile.audio, vibeProfile.audio],
    range: [low, high],
    summary: `${city} - ${guests} guests. ${budgetFit}`,
  };
}

function renderList(target, items) {
  target.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderSuppliers(recommendation) {
  const local = suppliers.filter(
    (supplier) => supplier.city === recommendation.city && supplier.fit.includes(recommendation.eventType)
  );
  const fallback = suppliers
    .filter((supplier) => supplier.city !== recommendation.city && supplier.fit.includes(recommendation.eventType))
    .slice(0, 3 - local.length);
  const matches = [...local, ...fallback].slice(0, 3);
  currentMatches = matches;

  if (!matches.length) {
    supplierGrid.innerHTML = `
      <article class="supplier-card">
        <div>
          <p class="supplier-type">${supplierSource === "supabase" ? "Supabase" : "Local data"}</p>
          <h3>No supplier matches yet</h3>
          <p>Add suppliers for ${escapeHtml(recommendation.city)} with the ${escapeHtml(recommendation.eventType)} event fit.</p>
        </div>
        <div class="supplier-meta">
          Edit suppliers in Supabase or suppliers.js.
        </div>
      </article>
    `;
    return;
  }

  supplierGrid.innerHTML = matches
    .map(
      (supplier) => `
        <article class="supplier-card">
          <div>
            <p class="supplier-type">${escapeHtml(supplier.type)}${supplierSource === "supabase" ? " - live" : ""}</p>
            <h3>${escapeHtml(supplier.name)}</h3>
            <p>${escapeHtml(supplier.summary)}</p>
          </div>
          <div class="supplier-tags">
            ${(supplier.categories || []).map((category) => `<span>${escapeHtml(category)}</span>`).join("")}
          </div>
          <div class="supplier-meta">
            <strong>${escapeHtml(supplier.city)}</strong><br />
            ${escapeHtml(supplier.price)}<br />
            <a href="#quotes" data-supplier="${escapeHtml(supplier.name)}">Route quote request</a>
          </div>
        </article>
      `
    )
    .join("");
}

function quoteValue(name) {
  return quoteForm.elements[name].value.trim();
}

function buildQuoteEmail(recommendation) {
  const name = quoteValue("name") || "New lead";
  const suburb = quoteValue("suburb") || recommendation.city;
  const eventDate = quoteValue("date") || "Date TBC";
  const notes = quoteValue("notes") || "No extra notes supplied.";
  const supplierNames = currentMatches.map((supplier) => supplier.name).join(", ") || "No supplier matches yet";

  return {
    subject: `EventRig AU quote request - ${recommendation.city} ${recommendation.eventType}`,
    body: [
      `Name: ${name}`,
      `Email: ${quoteValue("email") || "Not supplied"}`,
      `Phone: ${quoteValue("phone") || "Not supplied"}`,
      `Event date: ${eventDate}`,
      `Location: ${suburb}`,
      `Event type: ${recommendation.eventType}`,
      `Guests: ${recommendation.guests}`,
      `Estimated range: ${money(recommendation.range[0])} - ${money(recommendation.range[1])}`,
      "",
      "Lighting:",
      ...recommendation.lighting.map((item) => `- ${item}`),
      "",
      "Audio:",
      ...recommendation.audio.map((item) => `- ${item}`),
      "",
      `Matched suppliers: ${supplierNames}`,
      "",
      `Notes: ${notes}`,
    ].join("\n"),
  };
}

async function saveLeadRequest(recommendation) {
  const client = getSupabaseClient();
  const email = quoteValue("email");
  if (!client) {
    return { saved: false, message: "Supabase is not configured yet." };
  }
  if (!email) {
    return { saved: false, message: "Add an email to save this lead in Supabase." };
  }

  const { error } = await client.from("lead_requests").insert({
    name: quoteValue("name") || null,
    email,
    phone: quoteValue("phone") || null,
    city: recommendation.city,
    suburb: quoteValue("suburb") || null,
    event_type: recommendation.eventType,
    event_date: quoteValue("date") || null,
    guests: recommendation.guests,
    venue_size: formValue("venue"),
    vibe: formValue("vibe"),
    budget_value: Number(formValue("budget")),
    notes: quoteValue("notes") || null,
    recommended_equipment: {
      title: recommendation.title,
      lighting: recommendation.lighting,
      audio: recommendation.audio,
      estimated_range: recommendation.range,
    },
    matched_suppliers: currentMatches.map((supplier) => ({
      id: supplier.id || null,
      name: supplier.name,
      city: supplier.city,
      email: supplier.email || null,
      categories: supplier.categories || [],
    })),
  });

  if (error) {
    return { saved: false, message: error.message };
  }

  return { saved: true, message: "Saved to Supabase lead_requests." };
}

async function prepareQuoteRequest() {
  const recommendation = getRecommendation();
  const { subject, body } = buildQuoteEmail(recommendation);
  const leadEmail = "leads@eventrig.au";
  const mailto = `mailto:${leadEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  quoteButton.disabled = true;
  quoteButton.textContent = "Preparing...";
  const saveResult = await saveLeadRequest(recommendation);
  quoteButton.disabled = false;
  quoteButton.textContent = "Prepare quote request";

  quoteResult.hidden = false;
  quoteResult.innerHTML = `
    <p class="mini-label">Quote package ready</p>
    <h3>${escapeHtml(recommendation.title)}</h3>
    <p>${escapeHtml(recommendation.summary)}</p>
    <p><strong>Matched suppliers:</strong> ${escapeHtml(currentMatches.map((supplier) => supplier.name).join(", ") || "No matches yet")}</p>
    <p><strong>Data:</strong> ${escapeHtml(saveResult.message)}</p>
    <a class="button button-small" href="${mailto}">Open email draft</a>
  `;
}

function render() {
  const recommendation = getRecommendation();
  resultTitle.textContent = recommendation.title;
  resultSummary.textContent = recommendation.summary;
  renderList(lightingList, recommendation.lighting);
  renderList(audioList, recommendation.audio);
  budgetRange.textContent = `${money(recommendation.range[0])} - ${money(recommendation.range[1])}`;
  renderSuppliers(recommendation);
}

form.addEventListener("input", render);
form.addEventListener("change", render);
quoteButton.addEventListener("click", prepareQuoteRequest);
render();
loadSupabaseSuppliers();
