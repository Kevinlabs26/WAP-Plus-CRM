import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCallingCode, normalizePastedPhone, parsePastedContacts } from '../src/lib/pastedContacts.ts';
import { buildContactLinks, contactLinksCsv, contactLinksText } from '../src/lib/contactLinks.ts';
const rule = { prefix: '', start: 1, message: '' };

test('Excel names, accents, unnamed numbers and duplicates generate complete contact links', () => {
 const parsed = parsePastedContacts('Jean Yonli\t22650789388\nNathalie Mère Brian\t24106539883\n18494416486\nDuplicate\t22650789388', { allowUnnamed: true });
 assert.deepEqual(parsed.issues, []); assert.equal(parsed.duplicates, 1);
 const entries = buildContactLinks(parsed.contacts, { ...rule, prefix: '10/30', start: 5 });
 assert.deepEqual(entries, [
  { name: '10/30 Jean Yonli', phone: '+22650789388', url: 'https://wa.me/22650789388' },
  { name: '10/30 Nathalie Mère Brian', phone: '+24106539883', url: 'https://wa.me/24106539883' },
  { name: '10/30 7', phone: '+18494416486', url: 'https://wa.me/18494416486' },
 ]);
 assert.equal(contactLinksText(entries), entries.map(e => e.name + '\n' + e.url).join('\n\n'));
 assert.equal(parsed.contacts[0].name, 'Jean Yonli');
});

test('calling codes handle national prefixes without dropping meaningful zeros or changing explicit international numbers', () => {
 assert.equal(normalizeCallingCode(' +33 '), '33'); assert.equal(normalizeCallingCode('0086'), '86');
 assert.equal(normalizeCallingCode(''), ''); assert.equal(normalizeCallingCode('999'), null);
 assert.equal(normalizePastedPhone('06 00 00 00 01', '33'), '+33600000001');
 assert.equal(normalizePastedPhone('02 3661 8300', '39'), '+390236618300');
 assert.equal(normalizePastedPhone('13800138000', '86'), '+8613800138000');
 assert.equal(normalizePastedPhone('+24106539883', '33'), '+24106539883');
 assert.equal(normalizePastedPhone('0024106539883', '33'), '+24106539883');
 assert.equal(normalizePastedPhone('123', '33'), '');
 assert.equal(normalizePastedPhone('0600000001'), '');
 const parsed = parsePastedContacts('Nom\tTéléphone\nEssai\t06 00 00 00 01\n06 00 00 00 02', { allowUnnamed: true, defaultCallingCode: '33' });
 assert.deepEqual(parsed.issues, []); assert.deepEqual(parsed.contacts.map(c => c.phone), ['+33600000001', '+33600000002']);
});

test('preset messages are URL encoded and CSV preserves phone text and neutralizes formulas', () => {
 const message = 'Bonjour, 谢谢!\nA&B = 50% ? #';
 const entries = buildContactLinks([{ name: '=HYPERLINK("bad")', phone: '+12025550101' }], { ...rule, message });
 const url = new URL(entries[0].url);
 assert.equal(url.hostname, 'wa.me'); assert.equal(url.pathname, '/12025550101');
 assert.equal(url.searchParams.get('text'), message); assert.equal([...url.searchParams].length, 1);
 const csv = contactLinksCsv(entries);
 assert.ok(csv.startsWith('\uFEFFName,Phone,Link\r\n'));
 assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"')); assert.ok(csv.includes('"\'+12025550101"'));
 assert.equal(buildContactLinks([{name:'Test\nBEGIN:bad',phone:'+12025550101'}],{...rule,prefix:' Team\nX '})[0].name,'Team X Test BEGIN:bad');
});

test('malformed numbers, unsafe sequence values and oversized output are rejected', () => {
 const contacts = [{ name: 'Example', phone: '+12025550101' }];
 for (const start of [0, -1, 1.5, NaN, Infinity, 1_000_000_000]) assert.throws(() => buildContactLinks(contacts, { ...rule, start }));
 assert.throws(() => buildContactLinks([{name:'Bad',phone:'12025550101'}], rule));
 assert.throws(() => buildContactLinks(contacts, {...rule,message:'a'.repeat(2001)}));
 assert.throws(() => buildContactLinks(Array(2001).fill(contacts[0]), rule));
 assert.throws(() => buildContactLinks(Array(2000).fill(contacts[0]), {...rule,message:'字'.repeat(2000)}));
 const invalid = parsePastedContacts('Good\t12025550101\nBad\t123', {allowUnnamed:true});
 assert.deepEqual(invalid.issues, [{line:2,kind:'phone'}]);
});
