import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, beachName, date, items, total, confirmationId, waiverName, packageName } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Format date nicely
    const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });

    // Build items list HTML
    const itemsHtml = Object.entries(items || {}).map(([id, qty]) => {
      const labels = {
        tent: 'Tent', canopy: 'Canopy', umbrella: 'Umbrella', chair: 'Beach chair',
        tapestry: 'Tapestry', towel: 'Towel', kite: 'Kite', cooler: 'Cooler full of ice',
        cornhole: 'Cornhole set', laddergolf: 'Ladder golf set', frisbee: 'Frisbee'
      };
      return `<tr>
        <td style="padding:6px 0;color:#3A332B;">${labels[id] || id}</td>
        <td style="padding:6px 0;color:#3A332B;text-align:right;">×${qty}</td>
      </tr>`;
    }).join('');

    const { data, error } = await resend.emails.send({
      from: 'BestBeachSetUp <onboarding@resend.dev>',
      to: email,
      subject: `Your BestBeachSetUp booking is confirmed — ${dateLabel}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#EDE6D6;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="background:#1B3A4B;border-radius:16px;padding:28px 24px;margin-bottom:16px;text-align:center;">
      <h1 style="color:#EDE6D6;margin:0;font-size:24px;letter-spacing:-0.5px;">BestBeachSetUp</h1>
      <p style="color:#EDE6D699;margin:6px 0 0;font-size:14px;">Your beach day is all set 🌊</p>
    </div>

    <!-- Confirmation -->
    <div style="background:#fff;border-radius:16px;padding:24px;margin-bottom:16px;">
      <h2 style="color:#1B3A4B;margin:0 0 16px;font-size:18px;">Booking confirmed</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #1B3A4B11;">
          <td style="padding:8px 0;color:#3A332B99;font-size:14px;">Beach</td>
          <td style="padding:8px 0;color:#1B3A4B;font-size:14px;text-align:right;font-weight:600;">${beachName}</td>
        </tr>
        <tr style="border-bottom:1px solid #1B3A4B11;">
          <td style="padding:8px 0;color:#3A332B99;font-size:14px;">Date</td>
          <td style="padding:8px 0;color:#1B3A4B;font-size:14px;text-align:right;font-weight:600;">${dateLabel}</td>
        </tr>
        <tr style="border-bottom:1px solid #1B3A4B11;">
          <td style="padding:8px 0;color:#3A332B99;font-size:14px;">Setup time</td>
          <td style="padding:8px 0;color:#1B3A4B;font-size:14px;text-align:right;font-weight:600;">10:00 AM</td>
        </tr>
        <tr style="border-bottom:1px solid #1B3A4B11;">
          <td style="padding:8px 0;color:#3A332B99;font-size:14px;">Breakdown</td>
          <td style="padding:8px 0;color:#1B3A4B;font-size:14px;text-align:right;font-weight:600;">~1 hr before sunset</td>
        </tr>
        ${packageName ? `<tr style="border-bottom:1px solid #1B3A4B11;">
          <td style="padding:8px 0;color:#3A332B99;font-size:14px;">Package</td>
          <td style="padding:8px 0;color:#1B3A4B;font-size:14px;text-align:right;font-weight:600;">${packageName}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:8px 0;color:#3A332B99;font-size:14px;">Confirmation #</td>
          <td style="padding:8px 0;color:#1B3A4B;font-size:14px;text-align:right;font-weight:600;font-family:monospace;">${confirmationId?.toUpperCase()}</td>
        </tr>
      </table>
    </div>

    <!-- Gear -->
    <div style="background:#fff;border-radius:16px;padding:24px;margin-bottom:16px;">
      <h3 style="color:#1B3A4B;margin:0 0 12px;font-size:16px;">What's coming</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${itemsHtml}
        <tr style="border-top:2px solid #1B3A4B22;">
          <td style="padding:10px 0;color:#1B3A4B;font-weight:700;font-size:15px;">Total paid</td>
          <td style="padding:10px 0;color:#1B3A4B;font-weight:700;font-size:15px;text-align:right;">$${Number(total).toFixed(2)}</td>
        </tr>
      </table>
    </div>

    <!-- Waiver note -->
    ${waiverName ? `<div style="background:#7A9E8E22;border-radius:12px;padding:14px 18px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#1B3A4B;">✓ Liability waiver signed by <strong>${waiverName}</strong></p>
    </div>` : ''}

    <!-- My Booking CTA -->
    <div style="background:#D96B4C;border-radius:16px;padding:20px 24px;margin-bottom:16px;text-align:center;">
      <p style="color:#fff;margin:0 0 12px;font-size:14px;">Access your booking page to check in, message us, or confirm gear at checkout.</p>
      <div style="background:#fff;border-radius:10px;padding:10px 16px;display:inline-block;">
        <p style="margin:0;font-size:13px;color:#3A332B99;">Your confirmation number</p>
        <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1B3A4B;font-family:monospace;">${confirmationId?.toUpperCase()}</p>
      </div>
    </div>

    <!-- Footer -->
    <p style="text-align:center;color:#3A332B66;font-size:12px;margin:0;">
      BestBeachSetUp · Tamarack Beach & Tower 36<br>
      Questions? Reply to this email or use the messaging feature in your booking page.
    </p>

  </div>
</body>
</html>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, id: data?.id });
  } catch (err) {
    console.error('Receipt error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
