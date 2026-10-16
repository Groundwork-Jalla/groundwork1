import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { displaySenderName, looksLikeEmail } from './chat-identity';
import { composeWhatsAppBody } from './whatsapp-body';
import { en } from '@/lib/i18n/en';
import { fr } from '@/lib/i18n/fr';

/**
 * No email address is anybody's name in a chat.
 *
 * Reported from testing: the admin shows as their email in a project chat. 122 picked the
 * display name with `COALESCE(NULLIF(full_name,''), email, 'Member')`, and a staff account
 * has no `full_name`, so it landed on the address.
 *
 * It is not a cosmetic problem. It publishes a working staff mailbox into a thread the
 * client can read, screenshot and forward — the exact invitation to move the conversation
 * off Groundwork that the product exists to prevent. The same line is carried to WhatsApp
 * since 126, so it leaves twice. And it cuts both ways: a client with no name on file
 * showed THEIR address to the contractor.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const thread = read('src/components/admin/conversations/ConversationThread.tsx');
const m127   = read('supabase/migrations/127_no_email_in_the_chat.sql');

describe('an address is recognised, and a name is not mistaken for one', () => {
  it.each([
    'philip@tryjalla.com',
    'contact@tryjalla.com',
    '  ruth@example.co.uk  ',
  ])('%s is an address', (v) => expect(looksLikeEmail(v)).toBe(true));

  it.each([
    'Ruth Nkeng',
    'Vanessa Gwanvoma',
    // Narrow on purpose: a dot does not make a name an address, and rewriting real names
    // would be the worse bug — silent, and it hides who spoke.
    'J. P. Ndongo',
    'Admin',
    'Jalla',
    'St. Mary',
  ])('%s is a name', (v) => expect(looksLikeEmail(v)).toBe(false));

  it('something with an @ in the middle of a sentence is not an address either', () => {
    expect(looksLikeEmail('meet me @ site')).toBe(false);
  });
});

describe('what a reader sees instead', () => {
  it('an address becomes what the person IS', () => {
    expect(displaySenderName('philip@tryjalla.com', 'Admin')).toBe('Admin');
  });

  it('so does a blank, or nothing at all', () => {
    // An unnamed bubble is the ambiguity the label was added to remove.
    expect(displaySenderName('', 'Member')).toBe('Member');
    expect(displaySenderName('   ', 'Member')).toBe('Member');
    expect(displaySenderName(null, 'Member')).toBe('Member');
    expect(displaySenderName(undefined, 'Member')).toBe('Member');
  });

  it('and a real name is left exactly as it is', () => {
    expect(displaySenderName('Ruth Nkeng', 'Member')).toBe('Ruth Nkeng');
  });
});

describe('the chat renders no name without passing through the guard', () => {
  it('no bubble prints sender_name raw', () => {
    // Including the internal note line: staff-only, but an address is still an address.
    expect(thread).not.toContain('{m.senderName}');
  });

  it('staff fall back to Admin, project members to Member', () => {
    expect(thread).toMatch(/roleOf\(m\.senderId\) \?\? 'staff'\) === 'staff'/);
    expect(thread).toMatch(/project\.chat\.name\.admin[\s\S]{0,60}project\.chat\.name\.member/);
  });

  it('and the role is not repeated when it is already the name shown', () => {
    // Otherwise a pre-127 admin row reads "Jalla · Jalla".
    expect(thread).toMatch(/role !== senderLabel\(m\)/);
  });
});

describe('it does not leave the platform either', () => {
  it('the WhatsApp message falls back the same way', () => {
    const out = composeWhatsAppBody({
      senderName: 'philip@tryjalla.com', senderRole: 'staff', projectName: 'Buea Residence',
      content: 'Please confirm the stage.', hasAttachments: false, lang: 'en', link: 'https://x/y',
    });
    expect(out).not.toContain('@tryjalla.com');
    expect(out).toContain('*Jalla* (Jalla)');
  });

  it('a client with no name does not have their own address sent to the contractor', () => {
    const out = composeWhatsAppBody({
      senderName: 'mary@gmail.com', senderRole: 'owner', projectName: 'P', content: 'ok',
      hasAttachments: false, lang: 'en', link: 'https://x/y',
    });
    expect(out).not.toContain('@gmail.com');
    expect(out).toContain('*Client* (Client)');
  });
});

describe('the source stops writing one', () => {
  it('email is gone from the fallback chain', () => {
    const fn = m127.slice(m127.indexOf('CREATE OR REPLACE FUNCTION public.send_message'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).not.toMatch(/COALESCE\(NULLIF\(full_name, ''\), email/);
    expect(body).toMatch(/CASE WHEN v_admin THEN 'Admin' ELSE 'Member' END/);
  });

  it('and a full_name that is itself an address does not slip through', () => {
    // People paste an address into a name field.
    expect(m127).toMatch(/v_name IS NULL OR v_name LIKE '%@%'/);
  });

  it('every other rule of 122 is still enforced', () => {
    // This replaces the whole function, so dropping one of these would be a silent
    // regression in who may write and in what direction.
    for (const rule of ['not_signed_in', 'empty_message', 'not_found', 'not_member',
                        'bad_direction', 'log_activity']) {
      expect(m127).toContain(rule);
    }
  });
});

describe('the history is cleaned, not just the future', () => {
  it('existing rows carrying an address are rewritten', () => {
    // A fix from here forward leaves the address where scrolling up still finds it.
    expect(m127).toMatch(/UPDATE public\.project_messages/);
    expect(m127).toMatch(/WHERE m\.sender_name LIKE '%@%'/);
  });

  it('preferring a real name over a label', () => {
    expect(m127).toMatch(/NULLIF\(btrim\(p\.full_name\), ''\)/);
  });

  it('and never rewriting a message that is not ours', () => {
    // An inbound provider message (077) carries whatever the contact is called there.
    expect(m127).toMatch(/AND m\.sender_id IS NOT NULL/);
  });
});

describe('both languages have the generic names', () => {
  it.each(['admin', 'member'])('%s', (k) => {
    expect(typeof (en as any).project.chat.name[k]).toBe('string');
    expect((en as any).project.chat.name[k].length).toBeGreaterThan(0);
    expect(typeof (fr as any).project.chat.name[k]).toBe('string');
    expect((fr as any).project.chat.name[k].length).toBeGreaterThan(0);
  });

  it('and French translates the one that differs', () => {
    expect((fr as any).project.chat.name.member).toBe('Membre');
  });

  it('neither language uses an address as a fallback', () => {
    for (const d of [en, fr]) {
      expect(JSON.stringify((d as any).project.chat.name)).not.toContain('@');
    }
  });
});
