// Fictional local business websites for the product demo video. Each has realistic content and
// realistic SEO problems (weak titles, missing descriptions, slow images, no click-to-call …).
import http from "node:http";

type Site = { port: number; domain: string; name: string; pages: Record<string, string> };

const css = `body{margin:0;font-family:Georgia,serif;color:#222;background:#fffaf3}header{background:#2b1d0e;color:#fff;padding:14px 40px;display:flex;justify-content:space-between;align-items:center}
header a{color:#f6d9a8;margin-left:22px;text-decoration:none;font-family:Arial}.hero{height:420px;background:linear-gradient(120deg,#f59e0b,#b45309 60%,#7c2d12);display:flex;flex-direction:column;justify-content:center;padding:0 60px;color:#fff}
.hero .t{font-size:52px;font-weight:bold;letter-spacing:2px}.hero p{font-size:20px;max-width:620px}main{padding:30px 60px;max-width:1000px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.card{background:#fff;border:1px solid #eadfcb;border-radius:10px;padding:18px}footer{background:#2b1d0e;color:#cbb;padding:24px 60px;margin-top:40px;font-family:Arial;font-size:13px}`;

const page = (o: { title?: string; desc?: string; body: string; hero?: string; site: string }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta property="og:site_name" content="${o.site}">
${o.title !== undefined ? `<title>${o.title}</title>` : ""}${o.desc ? `<meta name="description" content="${o.desc}">` : ""}<style>${css}</style></head>
<body><header><b>${o.site}</b><nav><a href="/">Home</a><a href="/tours">Tours</a><a href="/prices">Prices</a><a href="/about">About</a><a href="/contact">Contact</a></nav></header>
${o.hero ?? ""}<main>${o.body}</main><footer>© 2026 ${o.site}. All rights reserved.</footer></body></html>`;

const lorem = (topic: string) =>
  `<p>${topic} is one of the most loved experiences for families and tourists. Our experienced team takes care of everything from hotel pickup to the moment you return, so you can simply enjoy the day. We have welcomed guests from all over the world and every trip is planned with safety first.</p>
<p>Book early in the season, because the best morning slots fill up quickly. Children are welcome and private options are available for couples and groups. Hot drinks, photos and a certificate are included with every booking.</p>`;

export const SITES: Site[] = [
  {
    port: 4101,
    domain: "desertskyballoons.ae",
    name: "Desert Sky Balloon Rides",
    pages: {},
  },
  {
    port: 4102,
    domain: "brightsmiledental.co.uk",
    name: "Bright Smile Dental",
    pages: {},
  },
  {
    port: 4103,
    domain: "karachimovers.pk",
    name: "Karachi City Movers",
    pages: {},
  },
];

// Desert Sky: no clear headline, homepage without a description, slow images, WhatsApp only in the footer.
SITES[0].pages = {
  "/": page({
    site: "Desert Sky Balloon Rides",
    title: "Home",
    hero: `<div class="hero"><div class="t">WELCOME TO THE SKY!!</div><p>Unforgettable sunrise flights over the golden dunes.</p></div>`,
    body: `<h2>Our flights</h2><div class="cards"><div class="card"><h3>Classic Sunrise</h3><p>60 minutes over the Dubai desert.</p></div><div class="card"><h3>Private Basket</h3><p>Just the two of you and the pilot.</p></div><div class="card"><h3>Falcon Show</h3><p>Breakfast and a falcon display after landing.</p></div></div>
${lorem("A hot air balloon ride in Dubai")}<img src="/img/balloon-1.jpg" width="420" height="233" style="margin:8px 8px 0 0;border-radius:10px"><img src="/img/balloon-2.jpg" width="420" height="233" style="margin:8px 8px 0 0;border-radius:10px"><p>Chat with us on <a href="https://wa.me/971501234567">WhatsApp</a>.</p>`,
  }),
  "/tours": page({ site: "Desert Sky Balloon Rides", title: "Tours", body: `<h1>Tours</h1>${lorem("Our sunrise balloon tour")}<img src="/img/tour.jpg" width="420" height="233" style="margin:8px 8px 0 0;border-radius:10px">` }),
  "/prices": page({ site: "Desert Sky Balloon Rides", title: "Tours", body: `<h1>Prices</h1><p>Classic from AED 995 per person. Private basket on request.</p>` }),
  "/about": page({ site: "Desert Sky Balloon Rides", title: "About Desert Sky Balloon Rides", desc: "Licensed balloon pilots in Dubai since 2012.", body: `<h2>About us</h2>${lorem("Flying with a licensed pilot")}` }),
  "/contact": page({ site: "Desert Sky Balloon Rides", title: "Contact", body: `<h1>Contact</h1><p>Email bookings@desertskyballoons.ae · Office: Al Quoz, Dubai</p><form><input placeholder="Name"><button>Send</button></form>` }),
};

// Bright Smile: good basics, but thin service pages and duplicate titles.
SITES[1].pages = {
  "/": page({
    site: "Bright Smile Dental",
    title: "Bright Smile Dental | Family Dentist in Leeds",
    desc: "Friendly family dentist in Leeds city centre. Check-ups, whitening and implants.",
    hero: `<div class="hero" style="background:linear-gradient(120deg,#0ea5e9,#0369a1)"><h1 class="t">Family dentist in Leeds</h1><p>Gentle care for the whole family. New patients welcome.</p></div>`,
    body: `${lorem("A visit to the dentist")}<p>Call us on <a href="tel:+441134960000">0113 496 0000</a>.</p><img src="/img/team.jpg" width="420" height="233" style="margin:8px 8px 0 0;border-radius:10px">`,
  }),
  "/tours": page({ site: "Bright Smile Dental", title: "Dental Services", body: `<h1>Teeth whitening</h1><p>Short page about whitening.</p>` }),
  "/prices": page({ site: "Bright Smile Dental", title: "Dental Services", body: `<h1>Dental implants</h1>${lorem("A dental implant")}` }),
  "/about": page({ site: "Bright Smile Dental", title: "About us - Bright Smile Dental", body: `<h2>Our story</h2>${lorem("Our practice")}` }),
  "/contact": page({ site: "Bright Smile Dental", title: "Contact us - Bright Smile Dental", body: `<h1>Contact us</h1><p>hello@brightsmiledental.co.uk</p>` }),
};

// Karachi Movers: no titles on most pages, no contact path from the homepage.
SITES[2].pages = {
  "/": page({
    site: "Karachi City Movers",
    title: "Karachi City Movers",
    hero: `<div class="hero" style="background:linear-gradient(120deg,#16a34a,#14532d)"><div class="t">We move. You relax.</div><p>House shifting and office relocation across Karachi.</p></div>`,
    body: `${lorem("House shifting in Karachi")}<img src="/img/truck.jpg" width="420" height="233" style="margin:8px 8px 0 0;border-radius:10px">`,
  }),
  "/tours": page({ site: "Karachi City Movers", body: `<h1>Services</h1>${lorem("Office relocation")}` }),
  "/prices": page({ site: "Karachi City Movers", body: `<h1>Rates</h1><p>Call for a quote.</p>` }),
  "/about": page({ site: "Karachi City Movers", body: `<h2>About</h2>${lorem("Our moving team")}` }),
  "/contact": page({ site: "Karachi City Movers", title: "Contact", body: `<h1>Contact</h1><p>info@karachimovers.pk · <a href="tel:+923001234567">0300 1234567</a></p>` }),
};

// A heavy "photo" (padded SVG) so the speed checks have something to measure.
const img = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#d97706"/></linearGradient></defs><rect width="900" height="500" fill="url(#g)"/><circle cx="450" cy="190" r="110" fill="#dc2626"/><path d="M380 270 L450 380 L520 270Z" fill="#7c2d12"/><rect x="425" y="380" width="50" height="40" fill="#78350f"/><!-- ${"x".repeat(850_000)} --></svg>`);

export function startSites() {
  return SITES.map((s) =>
    http
      .createServer((req, res) => {
        const url = (req.url ?? "/").split("?")[0];
        if (url === "/robots.txt") return res.end("User-agent: *\nAllow: /\n");
        if (url.startsWith("/img/")) {
          res.writeHead(200, { "content-type": "image/svg+xml" });
          return res.end(img);
        }
        const html = s.pages[url];
        if (!html) {
          res.writeHead(404, { "content-type": "text/html" });
          return res.end("<h1>Not found</h1>");
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      })
      .listen(s.port, "127.0.0.1"),
  );
}
