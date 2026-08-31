import { describe, expect, it } from 'vitest';
import { htmlToText, buildNote } from '../../../api/ghl/_email-log';

/**
 * What lands on a contact's timeline in GoHighLevel.
 *
 * The point of the note is that someone picking up the phone can see what we already
 * said. That only works if the note is readable — an HTML email pasted raw, or one
 * flattened into a single line, tells them nothing they could act on.
 */
describe('htmlToText', () => {
  it('keeps the structure of the email', () => {
    const out = htmlToText('<p>Hello Ada</p><p>Your application was accepted.</p>');
    expect(out).toBe('Hello Ada\nYour application was accepted.');
  });

  it('keeps link targets, because "click the button" is useless without the button', () => {
    const out = htmlToText('<a href="https://example.test/invite/abc">Accept the invitation</a>');
    expect(out).toContain('https://example.test/invite/abc');
    expect(out).toContain('Accept the invitation');
  });

  it('throws away styling and scripts rather than transcribing them', () => {
    const out = htmlToText('<head><style>p{color:red}</style></head><body><p>Hi</p></body>');
    expect(out).toBe('Hi');
    expect(out).not.toContain('color');
  });

  it('decodes the entities our templates emit', () => {
    expect(htmlToText('<p>R&amp;D &quot;quoted&quot;</p>')).toBe('R&D "quoted"');
  });

  it('does not leave a wall of blank lines from nested tables', () => {
    const out = htmlToText('<table><tr><td><p>A</p></td></tr><tr><td><p>B</p></td></tr></table>');
    expect(out).toBe('A\nB');
  });
});

describe('buildNote', () => {
  const sentAt = new Date('2026-08-31T09:15:00Z');

  it('leads with what it was and when, so the timeline scans', () => {
    const note = buildNote({
      kind: 'contractor_application_decision',
      subject: 'Your application to Groundwork',
      html: '<p>Congratulations.</p>',
      sentAt,
    });
    expect(note).toContain('Application decision sent');
    expect(note).toContain('2026-08-31 09:15 UTC');
    expect(note).toContain('Subject: Your application to Groundwork');
    expect(note).toContain('Congratulations.');
  });

  it('trims a long body instead of burying every other note on the contact', () => {
    const note = buildNote({
      kind: 'other',
      subject: 'Long one',
      html: `<p>${'x'.repeat(5000)}</p>`,
      sentAt,
    });
    expect(note.length).toBeLessThan(1500);
    expect(note).toContain('[trimmed]');
  });

  it('records the subject alone when there is no body to show', () => {
    const note = buildNote({ kind: 'contractor_invite', subject: 'You are invited', sentAt });
    expect(note).toContain('Subject: You are invited');
    expect(note).not.toContain('[trimmed]');
  });
});
