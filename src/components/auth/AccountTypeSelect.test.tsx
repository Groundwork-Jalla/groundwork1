import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
import AccountTypeSelect from './AccountTypeSelect';

const render = (value: 'homeowner' | 'contractor', disabled = false) =>
  renderToStaticMarkup(<AccountTypeSelect value={value} onChange={() => {}} disabled={disabled} />);

describe('the account-type choice is two distinct coloured buttons, still a radio group', () => {
  it('shows the client and contractor options as buttons with their own colours', () => {
    const html = render('homeowner');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('auth.signup.accountType');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('type="checkbox"');
    // The two colours never share a fill or an outline.
    expect(html).toContain('bg-brand-green text-white');
    expect(html).toContain('border-brand-near-black bg-white text-brand-near-black');
  });

  it('fills the selected option and outlines the other, in both directions', () => {
    const client = render('homeowner');
    const homeownerButton = client.match(/<button[^>]*data-account-type="homeowner"[^>]*>/)?.[0] ?? '';
    expect(homeownerButton).toContain('aria-checked="true"');
    expect(client).toContain('bg-brand-green text-white');
    expect(client).toContain('bg-white text-brand-near-black');

    const contractor = render('contractor');
    expect(contractor).toContain('bg-brand-near-black text-white');
    expect(contractor).toContain('bg-white text-brand-green');
    expect(contractor.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it('only reports a change when a different option is chosen', () => {
    const onChange = vi.fn();
    const el = AccountTypeSelect({ value: 'homeowner', onChange });
    const group = el.props.children[1];
    const [clientBtn, contractorBtn] = group.props.children;
    clientBtn.props.onClick();
    expect(onChange).not.toHaveBeenCalled();
    contractorBtn.props.onClick();
    expect(onChange).toHaveBeenCalledWith('contractor');
  });

  it('is disabled while the form is submitting, like the radios it replaced', () => {
    expect(render('homeowner', true).match(/disabled=""/g)).toHaveLength(2);
    expect(render('homeowner')).not.toContain('disabled=""');
  });

  it('keeps both options high-contrast in dark mode (never black-on-black)', () => {
    const client = render('homeowner');
    expect(client).toContain('dark:border-[#f0f0f0]/75');
    expect(client).toContain('dark:text-[#f0f0f0]');

    const contractor = render('contractor');
    expect(contractor).toContain('dark:bg-[#f0f0f0]');
    expect(contractor).toContain('dark:text-[#0a0a0a]');
    expect(contractor).toContain('dark:text-[#86efac]');
  });

  it('is large enough to tap on a phone', () => {
    expect(render('homeowner')).toContain('min-h-12');
    expect(render('homeowner')).toContain('grid-cols-2');
  });
});
