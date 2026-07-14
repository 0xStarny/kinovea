// POST /api/kq/patient-lookup
// Body: { niss }
// Returns { found:false } or { found:true, patientId, patient:{...best-effort} }.
//
// Mirrors the original widget: a found patient is identified by Id and books directly
// (no re-entry of personal details). New patients (not found) fill the details form.
const { signedPost } = require('./_lib/kqAuth');

module.exports = async (req, res) => {
  try {
    const niss = (req.body && req.body.niss ? req.body.niss : '').toString().replace(/\D/g, '');
    if (!niss) return res.status(400).json({ error: 'niss required' });

    const r = await signedPost('WebAgenda/GetExistingPatient', { Id: niss });
    const p = r.body;
    if (r.status !== 200 || !p || p === false || p.Id === 0 || p.Id === undefined) {
      return res.status(200).json({ found: false });
    }

    res.status(200).json({
      found: true,
      patientId: p.Id,
      // best-effort details if the backend returns them (display only)
      patient: {
        firstName: p.FirstName || '',
        familyName: p.FamilyName || '',
        zip: p.ZIP || '',
        city: p.City || '',
        street: p.StreetNbr || '',
        email: p.EMail || '',
        phone: p.Telephone || ''
      }
    });
  } catch (e) {
    res.status(200).json({ found: false });
  }
};
