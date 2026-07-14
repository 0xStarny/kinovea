// GET /api/kq/config
// Returns a reshaped, front-friendly KineQuick config (server-cached, 5 min).
// Precomputes isCabinet per location so the front can split Cabinet vs À domicile.
const { getConfig } = require('./_lib/kqAuth');

let cache = null;
let cacheTs = 0;
const CABINET_IDS = new Set([1, 23]); // Kinovea Lasne, Kinovea Rhode-Saint-Genèse

module.exports = async (req, res) => {
  try {
    if (!cache || Date.now() - cacheTs > 300000) {
      cache = await getConfig();
      cacheTs = Date.now();
    }
    const c = cache;
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.status(200).json({
      locations: c.locations.map((l) => ({
        id: l.Id,
        name: l.Name,
        address: l.Address,
        opening: l.OpeningTime,
        closing: l.ClosingTime,
        isCabinet: CABINET_IDS.has(l.Id),
        // nested availability graph: which specialties -> types -> therapists this location offers
        specialties: (l.specialties || []).map((s) => ({
          id: s.ID,
          types: (s.appointmentTypes || []).map((t) => ({ id: t.ID, therapists: t.Therapists || [] }))
        }))
      })),
      specialties: c.specialties.map((s) => ({ id: s.Id, name: s.Description.FR })),
      appointmentTypes: c.appointmentTypes.map((t) => ({ id: t.Id, name: t.Description.FR, duration: t.Duration })),
      therapists: c.therapists.map((t) => ({ id: t.Id, name: t.Name })),
      rules: c.webAgendaOptions
    });
  } catch (e) {
    res.status(502).json({ error: 'config_unavailable' });
  }
};
