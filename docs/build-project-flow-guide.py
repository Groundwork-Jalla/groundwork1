"""Create a standalone, paginated HTML edition of the agreed project workflow."""
from pathlib import Path
import html
import re

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'project-workflow-behaviour-2026-11-14.md'
AUDIT = HERE / 'meeting-implementation-audit-2026-11-14.md'
OUT = HERE / 'Groundwork-Project-and-Payment-Flow-Guide-2026-11-14.html'


def inline(value):
    value = html.escape(value)
    value = re.sub(r'\[([^]]+)\]\(([^)]+)\)', r'\1', value)
    value = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)
    value = re.sub(r'`([^`]+)`', r'<code>\1</code>', value)
    return value


def markdown(value):
    lines = value.strip().splitlines()
    blocks, i = [], 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = [cell.strip() for cell in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', cell) for cell in row):
                    rows.append(row)
                i += 1
            blocks.append('<table><thead><tr>' + ''.join('<th>' + inline(cell) + '</th>' for cell in rows[0]) + '</tr></thead><tbody>'
                          + ''.join('<tr>' + ''.join('<td>' + inline(cell) + '</td>' for cell in row) + '</tr>' for row in rows[1:]) + '</tbody></table>')
            continue
        ordered = bool(re.match(r'^\d+\.\s', line))
        if ordered or line.startswith('- '):
            rows = []
            pattern = r'^\d+\.\s+' if ordered else r'^-\s+'
            while i < len(lines):
                current = lines[i].strip()
                if not re.match(pattern, current):
                    break
                item = re.sub(pattern, '', current)
                i += 1
                while i < len(lines) and lines[i].strip() and not re.match(r'^(?:\d+\.\s|-\s|\|)', lines[i].strip()):
                    item += ' ' + lines[i].strip()
                    i += 1
                rows.append('<li>' + inline(item) + '</li>')
            tag = 'ol' if ordered else 'ul'
            blocks.append('<' + tag + '>' + ''.join(rows) + '</' + tag + '>')
            continue
        para = line
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r'^(?:\d+\.\s|-\s|\|)', lines[i].strip()):
            para += ' ' + lines[i].strip()
            i += 1
        blocks.append('<p>' + inline(para) + '</p>')
    return '\n'.join(blocks)


pages = []


def add(title, body, eyebrow='WORKFLOW REFERENCE', extra=''):
    number = len(pages) + 1
    pages.append(f'<section class="page {extra}" id="page-{number}"><div class="running-brand"><strong>Groundwork</strong><span>by Jalla</span></div>'
                 f'<div class="eyebrow">{eyebrow}</div><h1>{html.escape(title)}</h1>{body}</section>')


add('Projects, evidence\nand payment flows', '''
<p class="subtitle">A detailed guide to project creation, invitations, work reviews, receipts, installments and approved price changes.</p>
<p class="edition">Product behavior reference · 14 November 2026</p>
<div class="three-cards">
 <div><b>01</b><strong>Work approval</strong><span>Has the client approved the construction updates?</span></div>
 <div><b>02</b><strong>Money received</strong><span>Has the contractor confirmed the actual payment?</span></div>
 <div><b>03</b><strong>Permission to proceed</strong><span>May current work or the next stage continue?</span></div>
</div>
<p>These are separate decisions. Approved work can still have an unpaid balance. Recording money received does not automatically authorize work.</p>
<div class="flow-box"><small>CONTRACTOR-CREATED PROJECT</small><p>Evidence → Client approval → Payment for that same stage → Contractor decisions → Next stage</p></div>
<div class="flow-box"><small>CLIENT-CREATED PROJECT</small><p>Payment and work authorization → Evidence → Client approval → Progression check → Next stage</p></div>
<div class="notice"><strong>How to use this guide</strong><p>This describes the current implementation and the latest decisions in the working sessions and chat. It is a reference for the comprehensive test, not a statement that every scenario has passed live. The latest invitation, notification and navigation changes still require their matching release.</p></div>
<div class="contents"><b>Inside this guide</b><p>Roles · Creation and BOQs · Invitations · Both project origins · Full and split payments · Partial balances · Receipt exceptions · Currency · Price changes · Notifications · Remaining work · Acceptance checklist</p></div>
''', 'PRODUCT WORKING GUIDE', 'cover')

source = SOURCE.read_text()
sections = re.split(r'^## (.+)\n', source, flags=re.M)
for i in range(1, len(sections), 2):
    title, body = sections[i], sections[i + 1]
    body = body.replace('Actual email launch configuration and direct Meta WhatsApp integration\nremain separate work in [the implementation audit](meeting-implementation-audit-2026-11-14.md).',
                        'Actual email launch configuration and direct Meta WhatsApp integration remain separate work, listed later in this guide.')
    rendered = markdown(body)
    if title == 'Responsibilities':
        rendered += '''<div class="notice"><strong>Who can manage invitations?</strong><p>The primary client and primary contractor manage the eligible invitations. Additional contractors and observers cannot invite people or promote themselves. An administrator has separate account and project administration tools.</p></div>
<div class="example"><strong>If the client wants to edit a stage price</strong><p>The normal interaction is a contractor proposal followed by client approval. The client can approve or keep current prices. A price change can increase or reduce the shared project total. The full process is explained on page 10.</p></div>'''
    elif title == 'Creation and invitations':
        rendered += '''<div class="example"><strong>Confirmed BOQ example</strong><p>A BOQ total of <b>141,407,337.524</b> stays the confirmed native total. Its saved stage allocations sum to that figure, without additional BOQ fees. A later client-approved revision can change the agreed total while preserving the original document.</p></div>'''
    elif title.startswith('Contractor-created'):
        rendered += '''<div class="example"><strong>Stage 4 into Stage 5</strong><p>The contractor uploads Stage 4 updates. The client approves Stage 4 and pays for Stage 4. After settlement or explicit progression permission, Stage 5 opens for its own evidence. This repeats at every live stage.</p></div>'''
    elif title.startswith('Client-created'):
        rendered += '''<div class="example"><strong>Stage 4 into Stage 5</strong><p>The client funds Stage 4, and the contractor authorizes work. The contractor uploads Stage 4 updates for client approval. Once the progression conditions are met, Stage 5 awaits its own funding and work authorization.</p></div>'''
    elif title == 'Full payment and two installments':
        rendered += '''<table><thead><tr><th>Plan</th><th>Separate receipt files</th><th>Planned total</th></tr></thead><tbody>
<tr><td>Installment 1</td><td>200,000 + 400,000 XAF</td><td>600,000 XAF</td></tr>
<tr><td>Installment 2</td><td>150,000 + 250,000 XAF</td><td>400,000 XAF</td></tr>
<tr class="total"><td>Whole stage</td><td>Four proofs, individually reviewed</td><td>1,000,000 XAF</td></tr></tbody></table>'''
    elif title == 'The three separate decisions':
        rendered += '''<div class="notice"><strong>Full settlement still needs approved work</strong><p>If all money has been received but the work has not been approved, the stage does not complete automatically. If the work is approved and a balance remains, the primary contractor decides whether to wait or explicitly authorize progression.</p></div>'''
    elif title == 'Currency, historical work and special states':
        rendered += '''<div class="formula"><small>WHERE CROSS-CURRENCY CONVERSION IS REQUIRED</small><p>Receipt amount ÷ saved receipt currency per USD × saved project currency per USD</p><span>Both conversion legs and the original receipt amount remain recorded.</span></div>'''
    elif title == 'Stage price changes and what a client can edit':
        rendered += '''<table><thead><tr><th>Example</th><th>Before proposal</th><th>After client approval</th></tr></thead><tbody>
<tr><td>Selected stage</td><td>1,000,000 XAF</td><td>1,200,000 XAF</td></tr>
<tr><td>Project total</td><td>10,000,000 XAF</td><td>10,200,000 XAF</td></tr>
<tr><td>Previously received money</td><td>Recorded actual amount</td><td>Same recorded actual amount</td></tr></tbody></table>'''
    add(title, rendered)

audit = AUDIT.read_text()
remaining = audit.split('## What remains, in order\n', 1)[1].split('## Unimplemented follow-on scope', 1)[0]
add('Remaining implementation and release work', markdown(remaining) + '''
<div class="notice"><strong>What has already been checked locally</strong><p>225 focused UI/unit tests in 14 files passed, along with TypeScript checking, the production build and isolated PostgreSQL payment/notification regressions. These checks do not replace the comprehensive deployed test.</p></div>''', 'IMPLEMENTATION STATUS')

future = audit.split('## Unimplemented follow-on scope, not silent omissions from the current payment release\n', 1)[1].split('The normal pricing workflow', 1)[0]
add('Deferred work and team follow-up', markdown(future) + '''
<p>These items are listed separately so deferred scope is not confused with a broken payment feature or missing release configuration.</p>
<div class="notice"><strong>Decision precedence</strong><p>The latest direct decisions govern: Groundwork Admin owns activation automation; Meta WhatsApp is the next phase; links have no expiration; multiple receipts can count toward two installments; and client-approved revisions can affect every stage.</p></div>''', 'FOLLOW-ON SCOPE')

checks = [
 ('Both creation origins', 'Run complete repeating stage cycles for a client-created and contractor-created project.'),
 ('BOQ correctness', 'Check the stated grand total, precision, zero fees, exact allocation sum and identical participant figures.'),
 ('New and existing invitees', 'Verify signup/login, email confirmation, required onboarding and exact project continuation.'),
 ('Invitation roles', 'Exercise primary client, primary/additional contractor, observer and family links; reject privilege escalation.'),
 ('Single-use links', 'Check first claim, same-account reopen, second-account refusal and revocation.'),
 ('Full and split plans', 'Use full payment and an accepted/revised two-installment plan with several receipts per installment.'),
 ('Receipt errors', 'Try an unrelated image, unreadable proof, wrong amount/currency and provider unavailability.'),
 ('Partial decisions', 'Record only, request more, allow current work, wait for settlement and authorize progression with debt.'),
 ('Pending batches', 'Authorize work from confirmed money while a separate receipt remains pending and uncounted.'),
 ('Corrections and duplicates', 'Replace unconfirmed/flagged proof; preserve confirmed proof and prevent duplicate counting.'),
 ('Later balances', 'Pay an old outstanding balance after work completion without reopening or skipping stages.'),
 ('Pricing and history', 'Approve/retain/withdraw proposals; edit zero/completed stages; check totals and prior snapshots.'),
 ('Currency', 'Compare saved project/receipt conversions and source/date labels across both participant views.'),
 ('Stage boundaries', 'Cover historical, zero, future, final, on-hold and archived stages/projects.'),
 ('Navigation and notices', 'Check Back on every dashboard and exact notification targets with read-only observer permissions.'),
 ('Communication framework', 'After configuration, verify four journeys, English/French messages, Day 1/3/7, replies, opt-out and human recovery.'),
]
for part, cases in enumerate([checks[:8], checks[8:]], 1):
    add(f'Comprehensive test checklist ({part}/2)', '<p>Run this after implementation and release, using controlled accounts. Record results and compare both participant views after each saved decision.</p>'
        + '<table class="checklist"><thead><tr><th>Use case</th><th>What to confirm</th></tr></thead><tbody>'
        + ''.join('<tr><td>' + inline(a) + '</td><td>' + inline(b) + '</td></tr>' for a, b in cases)
        + '</tbody></table><p class="small">Test the actual action, receipt, balance and destination—not just whether a button is visible.</p>', 'LATER ACCEPTANCE')

style = '''
@page { size: A4; margin: 15mm 16mm 18mm; }
* { box-sizing: border-box; }
html { background: #fff; }
body { margin: 0; color: #263b32; font-family: 'Noto Sans', Arial, sans-serif; font-size: 10.2pt; line-height: 1.5; }
.page { width: 178mm; height: 260mm; break-after: page; position: relative; padding-top: 2mm; }
.page:last-child { break-after: auto; }
.running-brand { display: flex; align-items: baseline; gap: 6px; color: #1f4d3a; margin-bottom: 11mm; padding-bottom: 3mm; border-bottom: 1px solid #dce6df; }
.running-brand strong { font-size: 13pt; letter-spacing: -.35px; }
.running-brand span { font-size: 8pt; color: #687a70; }
.eyebrow { font-size: 7.7pt; font-weight: 700; letter-spacing: 1.8px; color: #597263; margin-bottom: 3mm; }
h1 { margin: 0 0 6mm; color: #173e2c; font-size: 23pt; line-height: 1.18; letter-spacing: -.6px; white-space: pre-line; }
p { margin: 0 0 3.8mm; }
strong { font-weight: 700; }
ul, ol { margin: 3mm 0 4mm; padding-left: 6mm; }
li { padding-left: 1.2mm; margin-bottom: 2.8mm; }
li::marker { color: #1f4d3a; font-weight: 700; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; line-height: 1.42; margin: 5mm 0; table-layout: fixed; }
thead { display: table-header-group; }
th { text-align: left; color: #fff; background: #1f4d3a; padding: 3mm; font-size: 8.3pt; }
td { vertical-align: top; padding: 3mm; border-bottom: 1px solid #dde7e0; overflow-wrap: break-word; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) { background: #f3f7f4; }
th:first-child,td:first-child { width: 30%; }
.total { font-weight: 700; }
code { font-size: 8.3pt; background: #eef3ef; padding: .3mm 1mm; border-radius: 2px; overflow-wrap: anywhere; }
.notice,.example,.formula { break-inside: avoid; margin: 5mm 0; border-radius: 4px; padding: 4mm 4.5mm; background: #edf4ef; border-left: 3px solid #2e674a; }
.notice p,.example p,.formula p { margin: 1.5mm 0 0; }
.example { background: #faf6ed; border-color: #c69b4d; }
.formula { font-size: 9.3pt; }
.formula p { font-weight: 700; }
.formula span { display: block; font-size: 8.5pt; margin-top: 2mm; }
.small { font-size: 8.5pt; color: #617167; }
.cover h1 { font-size: 34pt; margin: 2mm 0 5mm; letter-spacing: -1px; }
.subtitle { max-width: 160mm; font-size: 12pt; color: #53665a; }
.edition { font-size: 8.5pt; color: #6d7e72; margin: 5mm 0; }
.three-cards { display: grid; grid-template-columns: repeat(3,1fr); gap: 3mm; margin: 7mm 0 5mm; }
.three-cards > div { border: 1px solid #dce6df; border-radius: 5px; padding: 4mm; min-height: 37mm; }
.three-cards b { display: block; color: #477155; font-size: 8pt; margin-bottom: 2mm; }
.three-cards strong { display: block; font-size: 9.4pt; margin-bottom: 2mm; }
.three-cards span { font-size: 8.4pt; line-height: 1.4; display: block; }
.flow-box { border-top: 1px solid #dce6df; padding-top: 3mm; margin-top: 4mm; }
small { font-size: 7.8pt; font-weight: 700; letter-spacing: .5px; color: #477155; }
.flow-box p { font-size: 9.8pt; font-weight: 600; margin-top: 2mm; }
.contents { margin-top: 5mm; font-size: 8.5pt; color: #607368; }
.contents p { margin-top: 2mm; }
.checklist { font-size: 9pt; margin: 3mm 0; }
.checklist td { padding: 3mm; }
'''

OUT.write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Groundwork | Project and Payment Flow Guide</title>'
               '<meta name="author" content="Groundwork by Jalla"><meta name="description" content="Project creation, invitations, evidence, payments, installments and stage pricing.">'
               '<style>' + style + '</style></head><body>' + '\n'.join(pages) + '</body></html>')
print(f'Created {len(pages)} authored pages: {OUT}')
