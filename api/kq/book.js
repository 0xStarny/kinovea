// POST /api/kq/book  — writes REAL appointments into the KineQuick agenda.
// Body: { patient:{...}, appointments:[{locationId, specialtyId, typeId, therapistId, start, remark?}] }
//   start = "dd/mm/yyyy hh:mm"
// Existing patient -> patient.id set (from patient-lookup). New patient -> patient details set, id omitted.
const { signedPost } = require('./_lib/kqAuth');

module.exports = async (req, res) => {
  try {
    const { patient = {}, appointments = [] } = req.body || {};
    if (!Array.isArray(appointments) || appointments.length === 0) {
      return res.status(400).json({ error: 'no appointments' });
    }
    if (appointments.length > 10) {
      return res.status(400).json({ error: 'too many appointments' }); // MaxTentReqPerSession
    }

    const details = {
      Language: 'FR',
      Title: patient.title || '',
      FirstName: patient.firstName || '',
      FamilyName: patient.familyName || '',
      BirthDate: '',
      StreetNbr: patient.street || '',
      ZIP: patient.zip || '',
      City: patient.city || '',
      EMail: patient.email || '',
      Telephone: patient.phone || ''
    };

    const results = [];
    for (const a of appointments) {
      const payload = {
        patientDetails: details,
        patientID: patient.id ? parseInt(patient.id, 10) : 0,
        patientBirthdate: patient.birthdate || '',
        appointmentRemark: a.remark || '',
        therapistID: parseInt(a.therapistId, 10),
        specialtyID: parseInt(a.specialtyId, 10),
        appointmentTypedID: parseInt(a.typeId, 10),
        appointmentStart: a.start,
        locationID: parseInt(a.locationId, 10)
      };
      const r = await signedPost('WebAgenda/AddAppointment', payload);
      const ok = r.status === 201 || r.status === 200;
      results.push({
        start: a.start,
        status: r.status,
        ok,
        // 401/403/409 => slot no longer available (per widget status mapping)
        reason: ok ? null : ([401, 403, 409].includes(r.status) ? 'slot_taken' : 'error')
      });
    }

    const allOk = results.every((r) => r.ok);
    res.status(allOk ? 201 : 207).json({ ok: allOk, results });
  } catch (e) {
    res.status(502).json({ error: 'book_error' });
  }
};
