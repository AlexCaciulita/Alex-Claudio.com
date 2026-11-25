// The Photography Services Agreement as a template: its fill-in fields and its text. Shared by the
// dashboard (editor and preview), the couple's signing page, and the server (which fingerprints the
// exact text that was signed). The wording follows Alex's agreement of March 2026.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContractDoc = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const VERSION = 1;
  const PHOTOGRAPHER = 'Alex Claudio Ventures LLC, d/b/a Alex Claudio Photography';
  const SIGNER = { name: 'Claudiu Alex Caciulita', title: 'Owner' };

  // What can be filled in, grouped as the editor shows them. "client: true" fields may be completed
  // by the couple when they sign, if left empty.
  const FIELDS = [
    { group: 'Client', key: 'client_name', label: 'Names', type: 'text' },
    { group: 'Client', key: 'client_address', label: 'Address', type: 'text', client: true },
    { group: 'Client', key: 'client_email', label: 'Email', type: 'text' },
    { group: 'Client', key: 'client_phone', label: 'Phone', type: 'text', client: true },
    { group: 'Event', key: 'event_date', label: 'Event date', type: 'date' },
    { group: 'Event', key: 'event_type', label: 'Event type', type: 'text', default: 'Wedding' },
    { group: 'Event', key: 'event_locations', label: 'Location(s)', type: 'text' },
    { group: 'Package', key: 'package_name', label: 'Package', type: 'text', default: 'Wedding Collection' },
    { group: 'Package', key: 'coverage_hours', label: 'Hours of coverage', type: 'number', default: 6 },
    { group: 'Package', key: 'photographers', label: 'Number of photographers', type: 'number', default: 1 },
    { group: 'Package', key: 'final_images', label: 'Expected final images', type: 'text', default: '500+' },
    { group: 'Package', key: 'online_gallery', label: 'Online gallery', type: 'yesno', default: 'Yes' },
    { group: 'Package', key: 'planning_call', label: 'Pre-wedding planning call', type: 'yesno', default: 'Yes' },
    { group: 'Package', key: 'meetup', label: 'Pre-wedding in-person meetup', type: 'yesno', default: 'Yes' },
    { group: 'Package', key: 'engagement_session', label: 'Engagement session', type: 'yesno', default: 'No' },
    { group: 'Package', key: 'additional_services', label: 'Additional services', type: 'text', default: 'None' },
    { group: 'Fees', key: 'package_price', label: 'Package price', type: 'money', default: 0 },
    { group: 'Fees', key: 'add_ons', label: 'Add-ons', type: 'money', default: 0 },
    { group: 'Fees', key: 'travel_fee', label: 'Travel fee', type: 'money', default: 0 },
    { group: 'Fees', key: 'sales_tax', label: 'Sales tax', type: 'money', default: 0 },
    { group: 'Fees', key: 'retainer', label: 'Retainer (due at signing)', type: 'money', default: 0 },
    { group: 'Fees', key: 'balance_days', label: 'Balance due, days before event', type: 'number', default: 7 },
    { group: 'Fees', key: 'hourly_rate', label: 'Additional hourly rate', type: 'money', default: 250 },
    { group: 'Terms', key: 'payment_methods', label: 'Accepted payment methods', type: 'text', default: 'Zelle, Venmo, Check, PayPal, Wire' },
    { group: 'Terms', key: 'late_fee_percent', label: 'Late fee, % per week', type: 'number', default: 10 },
    { group: 'Terms', key: 'cancellation_days', label: 'Cancellation window, days', type: 'number', default: 90 },
    { group: 'Terms', key: 'cancellation_percent', label: 'Owed if cancelled inside it, %', type: 'number', default: 50 },
    { group: 'Terms', key: 'delivery_timeline', label: 'Delivery timeline', type: 'text', default: '4-6 weeks' },
    { group: 'Terms', key: 'archive_months', label: 'Archive kept, months', type: 'number', default: 24 }
  ];
  const BY_KEY = Object.fromEntries(FIELDS.map((field) => [field.key, field]));
  const BLANK = '_______________________';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const longDate = (iso) => {
    if (!isDate(iso)) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  };
  const minusDays = (iso, days) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  };
  const cents = (value) => Math.round(Number(value || 0) * 100);
  const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const number = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : '';
  };

  function defaults() {
    const values = {};
    for (const field of FIELDS) values[field.key] = field.default !== undefined ? field.default : '';
    return values;
  }

  // Keeps only known fields, each in its own shape, so nothing else can be stored or shown.
  function clean(input) {
    const values = defaults();
    for (const field of FIELDS) {
      if (!input || !Object.prototype.hasOwnProperty.call(input, field.key)) continue;
      const raw = input[field.key];
      if (field.type === 'money' || field.type === 'number') {
        const n = Number(raw);
        values[field.key] = raw === '' || raw === null || !Number.isFinite(n) || n < 0 || n > 10000000 ? (field.type === 'money' ? 0 : '') : Math.round(n * 100) / 100;
      } else if (field.type === 'date') {
        values[field.key] = isDate(raw) ? raw : '';
      } else if (field.type === 'yesno') {
        values[field.key] = raw === 'No' ? 'No' : 'Yes';
      } else {
        values[field.key] = String(raw === null || raw === undefined ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 300);
      }
    }
    return values;
  }

  // Every value as the text prints it, including the totals worked out from the fees.
  function words(input) {
    const v = clean(input);
    const total = cents(v.package_price) + cents(v.add_ons) + cents(v.travel_fee) + cents(v.sales_tax);
    const retainer = Math.min(cents(v.retainer), total);
    const days = Number(v.balance_days) || 0;
    const show = (text) => (text === '' || text === null || text === undefined ? BLANK : String(text));
    return {
      ...Object.fromEntries(Object.entries(v).map(([key, value]) => [key, show(value)])),
      event_date: show(longDate(v.event_date)),
      total: money(total),
      retainer: money(retainer),
      balance: money(total - retainer),
      package_price: money(cents(v.package_price)),
      add_ons: money(cents(v.add_ons)),
      travel_fee: money(cents(v.travel_fee)),
      sales_tax: money(cents(v.sales_tax)),
      hourly_rate: money(cents(v.hourly_rate)),
      balance_days: show(number(v.balance_days)),
      balance_due: isDate(v.event_date) && days >= 0 ? longDate(minusDays(v.event_date, days)) : BLANK,
      coverage_hours: show(number(v.coverage_hours)),
      photographers: show(number(v.photographers)),
      photographer: PHOTOGRAPHER,
      signer_name: SIGNER.name,
      signer_title: SIGNER.title
    };
  }

  // The agreement, block by block. t: title, h (section), h3 (clause), p, li (list line), kv (label: value).
  const TEMPLATE = [
    ['title', 'PHOTOGRAPHY SERVICES AGREEMENT'],
    ['p', 'This Photography Services Agreement ("Agreement") is made between:'],
    ['h3', 'Photographer:'],
    ['p', '{photographer} ("Photographer")'],
    ['h3', 'Client:'],
    ['kv', 'Name', '{client_name}'],
    ['kv', 'Address', '{client_address}'],
    ['kv', 'Email', '{client_email}'],
    ['kv', 'Phone', '{client_phone}'],
    ['p', 'Collectively, the "Parties."'],
    ['kv', 'Event Date', '{event_date}'],
    ['kv', 'Event Type', '{event_type}'],
    ['kv', 'Event Location(s)', '{event_locations}'],
    ['p', 'This Agreement is effective as of the date it is signed by both Parties.'],

    ['h', '1. SCOPE OF SERVICES'],
    ['h3', '1.1 Services.'],
    ['p', 'Photographer agrees to provide photography services for Client\'s event as described in Schedule A - Package & Services (attached and incorporated into this Agreement).'],
    ['h3', '1.2 Coverage.'],
    ['p', 'Photographer will provide coverage on the Event Date for the number of hours specified in Schedule A. Additional hours requested by Client on the day of the event will be billed at the Additional Hourly Rate listed in Schedule A and are subject to Photographer\'s availability.'],
    ['h3', '1.3 Assistants / Second Shooters.'],
    ['p', 'Photographer may, at its discretion or as described in Schedule A, bring assistants or a second photographer to help perform the services.'],

    ['h', '2. FEES, RETAINER, AND PAYMENT TERMS'],
    ['h3', '2.1 Total Fee.'],
    ['p', 'Client agrees to pay Photographer the total fee stated in Schedule A ({total}).'],
    ['h3', '2.2 Retainer / Booking Fee.'],
    ['p', 'To reserve the Event Date, a non-refundable retainer of {retainer} is due upon signing this Agreement. Photographer will not hold or reserve the Event Date until the Retainer and signed Agreement are received.'],
    ['h3', '2.3 Payment Schedule.'],
    ['li', 'Retainer due upon signing: {retainer}'],
    ['li', 'Remaining balance of {balance} due no later than {balance_days} days before the Event Date.'],
    ['p', 'If this Agreement is signed within {balance_days} days of the Event Date, the Total Fee is due in full at signing.'],
    ['h3', '2.4 Late Payments.'],
    ['p', 'Any payment not received by the due date may, at Photographer\'s discretion, incur a late fee of {late_fee_percent}% of the outstanding balance per week until paid in full.'],
    ['h3', '2.5 Accepted Payment Methods.'],
    ['p', 'Photographer accepts the following payment methods: {payment_methods}.'],

    ['h', '3. CANCELLATION, RESCHEDULING & NO-SHOW'],
    ['h3', '3.1 Client Cancellation.'],
    ['p', 'If Client cancels the event or services for any reason:'],
    ['li', 'The Retainer is non-refundable.'],
    ['li', 'If cancellation occurs within {cancellation_days} days of the Event Date, Client will remain responsible for {cancellation_percent}% of the remaining balance (less any amounts already paid), due within 7 days of cancellation.'],
    ['h3', '3.2 Rescheduling by Client.'],
    ['p', 'If Client requests to reschedule:'],
    ['li', 'Photographer will make reasonable efforts to accommodate the new date, subject to availability.'],
    ['li', 'If Photographer is available on the new date, payments already made will be applied to the new date.'],
    ['li', 'If Photographer is not available for the new date, the request will be treated as a cancellation (Section 3.1).'],
    ['h3', '3.3 Cancellation by Photographer.'],
    ['p', 'If Photographer must cancel due to illness, emergency, or other circumstances beyond Photographer\'s control:'],
    ['li', 'Photographer will make reasonable efforts to find a replacement photographer of similar style and experience, subject to Client\'s approval, or'],
    ['li', 'Photographer will refund all amounts paid by Client (including the Retainer), and this Agreement will be terminated with no further liability to either Party.'],
    ['h3', '3.4 No-Show.'],
    ['p', 'If Client fails to appear or is more than 2 hours late to the event without reasonable notice, Photographer\'s obligations under this Agreement may be considered fulfilled and no refund will be given.'],

    ['h', '4. CLIENT RESPONSIBILITIES'],
    ['h3', '4.1 Permissions & Access.'],
    ['p', 'Client is responsible for:'],
    ['li', 'Securing permission from the venue and any necessary permits for professional photography.'],
    ['li', 'Ensuring Photographer has access to the venue(s) at agreed start time(s).'],
    ['h3', '4.2 Schedule & Shot List.'],
    ['p', 'Client agrees to provide:'],
    ['li', 'A final event timeline at least 7 days before the Event Date.'],
    ['li', 'Any "must-have" family groupings or key moments in writing (a simple shot list).'],
    ['p', 'Photographer will make reasonable efforts to capture requested images but does not guarantee every requested shot, especially if timing, logistics, or circumstances prevent it.'],
    ['h3', '4.3 Cooperation.'],
    ['p', 'Client agrees to ensure reasonable cooperation from guests, wedding party, and other vendors so Photographer can perform services effectively.'],

    ['h', '5. ARTISTIC STYLE & EDITING'],
    ['h3', '5.1 Artistic Discretion.'],
    ['p', 'Client acknowledges that Photographer\'s work is artistic in nature and that Photographer will use professional judgment regarding style, composition, lighting, and editing.'],
    ['h3', '5.2 Editing & Retouching.'],
    ['p', 'Photographer will deliver a selection of edited images at Photographer\'s discretion. Basic editing includes color correction, exposure, cropping, and minor adjustments. Extensive retouching (e.g., heavy skin retouching, object removal, head swaps) is not included unless specified and may incur additional fees.'],
    ['h3', '5.3 Raw Files.'],
    ['p', 'Client understands and agrees that RAW files / unedited images will not be delivered. Only edited final images, as selected and processed by Photographer, will be provided.'],

    ['h', '6. IMAGE DELIVERY'],
    ['h3', '6.1 Method of Delivery.'],
    ['p', 'Photographer will deliver final images via online gallery.'],
    ['h3', '6.2 Delivery Timeline.'],
    ['p', 'Unless otherwise specified, Photographer will deliver the final edited images within approximately {delivery_timeline} after the Event Date.'],
    ['h3', '6.3 Archiving.'],
    ['p', 'Photographer will make reasonable efforts to back up and archive images, but does not guarantee storage beyond {archive_months} months after image delivery. Client is responsible for downloading and backing up images.'],

    ['h', '7. COPYRIGHT & USAGE'],
    ['h3', '7.1 Copyright Ownership.'],
    ['p', 'All photographs created by Photographer are protected by copyright law. Photographer retains all copyrights and ownership of the images, digital files, and any related materials.'],
    ['h3', '7.2 Client License.'],
    ['p', 'Upon full payment of the Total Fee, Photographer grants Client a non-exclusive, non-transferable license to:'],
    ['li', 'Download and store the delivered images.'],
    ['li', 'Print the images for personal use.'],
    ['li', 'Share the images on personal social media, provided that Photographer is credited (e.g., "Photo by Alex Claudio Photography").'],
    ['p', 'Client may not:'],
    ['li', 'Sell the images or use them for commercial purposes.'],
    ['li', 'Submit them to publications, contests, or vendors without Photographer\'s written permission.'],
    ['li', 'Edit the images with filters or heavy alterations that misrepresent Photographer\'s style (unless Photographer agrees in writing).'],
    ['h3', '7.3 Vendors & Publications.'],
    ['p', 'If other vendors (e.g., planners, florists, makeup artists) request images for their marketing, Client agrees to direct those requests to Photographer. Photographer may provide images directly to vendors with appropriate credit.'],

    ['h', '8. MODEL RELEASE & PROMOTIONAL USE'],
    ['h3', '8.1 Model Release.'],
    ['p', 'Client grants Photographer and its assigns the irrevocable right to use and publish the images, including images of Client and Client\'s guests, for portfolio, website & blog, social media, sample albums, studio displays, and advertising and marketing in any medium now known or later developed, without additional compensation.'],
    ['p', 'If Client does not want images used publicly, Client must notify Photographer in writing before signing, and a modified clause may be agreed upon (which may affect pricing).'],

    ['h', '9. LIMITATION OF LIABILITY'],
    ['h3', '9.1 Maximum Liability.'],
    ['p', 'In the unlikely event of a total photographic failure, loss of images, or any other circumstance causing Client\'s images to be lost, destroyed, or otherwise not delivered, Photographer\'s liability is limited to the return of all payments received from Client under this Agreement.'],
    ['h3', '9.2 No Guaranteed Poses or Moments.'],
    ['p', 'Photographer cannot guarantee any specific pose, shot, or moment will be captured, especially if timing, location, or circumstances are beyond Photographer\'s control.'],
    ['h3', '9.3 Inherent Risks.'],
    ['p', 'Client acknowledges that event conditions (e.g., low light, bad weather, venue restrictions, guest interference) may impact the quality or quantity of images, and Photographer is not responsible for such limitations.'],

    ['h', '10. FORCE MAJEURE (ACTS BEYOND CONTROL)'],
    ['p', 'Neither Party shall be responsible for failure to perform this Agreement if such failure is caused by events beyond their reasonable control, including but not limited to acts of God, war, terrorism, government restrictions, pandemics, or sudden illness or death in the immediate family of Photographer.'],
    ['p', 'In such cases, Photographer will use reasonable efforts to reschedule the services, or refund payments received (excluding any services already completed), and be released from further liability.'],

    ['h', '11. MEALS, BREAKS & SAFE WORKING CONDITIONS'],
    ['h3', '11.1 Meals.'],
    ['p', 'For events lasting 6 hours or more, Client agrees to provide a meal and a reasonable break period for Photographer. Breaks will be taken at an appropriate time that does not interfere with key moments.'],
    ['h3', '11.2 Safe Environment.'],
    ['p', 'Client is responsible for ensuring a safe working environment. Photographer may leave any situation that presents danger, harassment, discrimination, or unsafe conditions, and Client will not be entitled to any refund if such circumstances are caused by Client, guests, or vendors.'],

    ['h', '12. MISCELLANEOUS'],
    ['h3', '12.1 Governing Law.'],
    ['p', 'This Agreement shall be governed by and construed in accordance with the laws of the State of Washington, without regard to its conflict of law principles.'],
    ['h3', '12.2 Entire Agreement.'],
    ['p', 'This Agreement, including Schedule A, constitutes the entire agreement between the Parties and supersedes all prior discussions or understandings, whether written or oral, relating to the subject matter.'],
    ['h3', '12.3 Amendments.'],
    ['p', 'Any changes or additions to this Agreement must be in writing and signed by both Parties.'],
    ['h3', '12.4 Severability.'],
    ['p', 'If any provision of this Agreement is held to be invalid or unenforceable, the remaining provisions shall continue in full force and effect.'],
    ['h3', '12.5 Assignment.'],
    ['p', 'Client may not assign this Agreement or any rights hereunder without Photographer\'s written consent.'],
    ['h3', '12.6 Notices.'],
    ['p', 'Any formal notices under this Agreement shall be in writing and sent to the email or postal address listed above, or such other addresses as either Party may specify in writing.'],

    ['h', '13. SIGNATURES'],
    ['p', 'By signing below, the Parties acknowledge that they have read, understood, and agree to the terms of this Agreement.'],
    ['signatures'],

    ['title', 'SCHEDULE A - PACKAGE & SERVICES'],
    ['kv', 'Client Name', '{client_name}'],
    ['kv', 'Event Date', '{event_date}'],
    ['h3', '1. Package: {package_name}'],
    ['li', 'Hours of coverage: {coverage_hours} hours'],
    ['li', 'Number of photographers: {photographers}'],
    ['li', 'Expected number of final edited images: {final_images}'],
    ['li', 'Deliverables:'],
    ['li2', 'Online gallery: {online_gallery}'],
    ['li2', 'Pre-wedding planning call: {planning_call}'],
    ['li2', 'Pre-wedding in-person meetup: {meetup}'],
    ['li2', 'Engagement session: {engagement_session}'],
    ['h3', '2. Additional Services: {additional_services}'],
    ['h3', '3. Fees:'],
    ['li', 'Package Price: {package_price}'],
    ['li', 'Add-ons: {add_ons}'],
    ['li', 'Travel fee: {travel_fee}'],
    ['li', 'Sales tax: {sales_tax}'],
    ['h3', 'Total Fee: {total}'],
    ['h3', '4. Payment Schedule:'],
    ['li', 'Retainer / Booking Fee: {retainer} (due at signing)'],
    ['li', 'Remaining Balance: {balance} (due by {balance_due} - {balance_days} days before event)'],
    ['li', 'Additional Hourly Rate: {hourly_rate} per hour (if requested by Client on event day and if Photographer is available)']
  ];

  const fill = (text, w) => text.replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(w, key) ? w[key] : match));

  // The agreement with the values in it, as blocks ready to draw.
  function blocks(input) {
    const w = words(input);
    return TEMPLATE.map(([t, a, b]) => {
      if (t === 'signatures') return { t };
      if (t === 'kv') return { t, label: a, text: fill(b, w) };
      return { t, text: fill(a, w) };
    });
  }

  // The exact words of the agreement as plain text. The server fingerprints this when it is signed.
  function text(input) {
    return blocks(input).map((block) => {
      if (block.t === 'signatures') return `Photographer: ${PHOTOGRAPHER}, by ${SIGNER.name}, ${SIGNER.title}. Client: ${words(input).client_name}.`;
      if (block.t === 'kv') return `${block.label}: ${block.text}`;
      if (block.t === 'li' || block.t === 'li2') return `- ${block.text}`;
      return block.text;
    }).join('\n');
  }

  // Fields that still print as blanks. The agreement can't be sent while any is empty, except the
  // ones the couple may fill in when they sign.
  function missing(input, { forClient = false } = {}) {
    const v = clean(input);
    return FIELDS.filter((field) => (field.type === 'text' || field.type === 'date') && v[field.key] === '' && (forClient || !field.client)).map((field) => field.key);
  }

  // Draws the agreement into a page element, with the signatures when there are any. Browser only.
  // sign: { photographer: {signature, signed_at}, client: {signature, name, signed_at} }
  function render(container, input, sign = {}) {
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const stamp = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : BLANK);
    const w = words(input);
    container.replaceChildren();
    container.classList.add('contract-doc');
    let list = null;
    for (const block of blocks(input)) {
      if (block.t !== 'li' && block.t !== 'li2') list = null;
      if (block.t === 'title') container.append(el('h1', 'cd-title', block.text));
      else if (block.t === 'h') container.append(el('h2', 'cd-h', block.text));
      else if (block.t === 'h3') container.append(el('h3', 'cd-h3', block.text));
      else if (block.t === 'p') container.append(el('p', 'cd-p', block.text));
      else if (block.t === 'kv') {
        const row = el('p', 'cd-kv');
        row.append(el('strong', '', `${block.label}: `), el('span', block.text === BLANK ? 'cd-blank' : 'cd-value', block.text));
        container.append(row);
      } else if (block.t === 'li' || block.t === 'li2') {
        if (!list) { list = el('ul', 'cd-list'); container.append(list); }
        list.append(el('li', block.t === 'li2' ? 'cd-li2' : '', block.text));
      } else if (block.t === 'signatures') {
        const grid = el('div', 'cd-signatures');
        const party = (title, lines, signature, date) => {
          const box = el('div', 'cd-party');
          box.append(el('h3', 'cd-h3', title));
          const sigLine = el('div', 'cd-sigline');
          if (signature) {
            const img = el('img', 'cd-sig');
            img.src = signature;
            img.alt = `Signature of ${title}`;
            sigLine.append(img);
          } else sigLine.append(el('span', 'cd-blank', 'Not signed yet'));
          box.append(...lines.map((text) => el('p', 'cd-p', text)), el('p', 'cd-label', 'Signature'), sigLine, el('p', 'cd-p', `Date: ${date}`));
          return box;
        };
        const ph = sign.photographer || {};
        const cl = sign.client || {};
        grid.append(
          party('Photographer', [PHOTOGRAPHER, `Name: ${SIGNER.name}`, `Title: ${SIGNER.title}`], ph.signature, ph.signed_at ? stamp(ph.signed_at) : BLANK),
          party('Client', [`Name: ${cl.name || w.client_name}`], cl.signature, cl.signed_at ? stamp(cl.signed_at) : BLANK));
        container.append(grid);
      }
    }
    return container;
  }

  return { VERSION, FIELDS, BY_KEY, PHOTOGRAPHER, SIGNER, BLANK, defaults, clean, words, blocks, text, missing, longDate, render };
}));
