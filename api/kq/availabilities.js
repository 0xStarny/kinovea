// POST /api/kq/availabilities
// Body: { locationId, specialtyId?, typeId?, weekStart? (ISO date) }
// Returns a flattened week model: { weekStart, weekEnd, firstAvailable, days: { "dd/mm/yyyy": [{start,end,therapistId}] } }
const { signedPost } = require('./_lib/kqAuth');

const pad = (n) => (n < 10 ? '0' + n : '' + n);
const ddmmyyyy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

function mondayOf(d) {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7; // 0 = Monday
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - wd);
  return x;
}

module.exports = async (req, res) => {
  try {
    const { locationId, specialtyId = '', typeId = '', weekStart } = req.body || {};
    if (!locationId) return res.status(400).json({ error: 'locationId required' });

    const base = weekStart ? new Date(weekStart) : new Date(Date.now() + 86400000);
    const start = mondayOf(base);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const r = await signedPost('WebAgenda/GetAvailabilities', {
      DateFrom: ddmmyyyy(start),
      DateTo: ddmmyyyy(end),
      OptionalLocationID: locationId,
      OptionalAppointmentTypeID: typeId,
      OptionalSpecialtyID: specialtyId
    });

    if (r.status !== 200 || typeof r.body !== 'object') {
      return res.status(502).json({ error: 'availabilities_unavailable' });
    }

    const byDate = {};
    (r.body.availabilities || []).forEach((a) =>
      (a.therapists || []).forEach((t) =>
        (t.days || []).forEach((day) =>
          (day.times || []).forEach((slot) => {
            (byDate[day.Date] ||= []).push({
              start: slot.Start,
              end: slot.End,
              therapistId: t.TherapistID
            });
          })
        )
      )
    );
    Object.values(byDate).forEach((arr) =>
      arr.sort((a, b) => (a.start === b.start ? a.therapistId - b.therapistId : a.start.localeCompare(b.start)))
    );

    res.status(200).json({
      weekStart: ddmmyyyy(start),
      weekEnd: ddmmyyyy(end),
      firstAvailable: (r.body.availabilitiesDetail && r.body.availabilitiesDetail.OptionalFirstAvailableDate) || '',
      days: byDate
    });
  } catch (e) {
    res.status(502).json({ error: 'availabilities_error' });
  }
};
