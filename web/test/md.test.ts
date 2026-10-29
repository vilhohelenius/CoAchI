import { describe, expect, it } from 'vitest'
import { md } from '../src/coach'

describe('coach markdown', () => {
  it('renders tables, lists, bold and escapes HTML', () => {
    const h = md('## Signals\n| a | b |\n|---|---|\n| **1** | <i>x</i> |\n\n- one\n- two\n\nplain <script>')
    expect(h).toContain('<h4>Signals</h4>'); expect(h).toContain('<th>a</th>'); expect(h).toContain('<td><b>1</b></td>'); expect(h).toContain('<li>two</li>')
    expect(h).not.toMatch(/<script|<i>/)
  })
})
