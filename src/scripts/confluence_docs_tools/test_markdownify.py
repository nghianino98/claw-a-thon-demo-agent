import markdownify

html = """
<table>
  <tr>
    <th>Feature</th>
    <th>Description</th>
  </tr>
  <tr>
    <td>Adapt new FS Hub</td>
    <td>
      <p>UI mới của FS Hub có tỷ lệ clicked rate.</p>
      <p>Có 2 step cần làm:</p>
      <ul>
        <li>(1) Promote MMF as a 1st product</li>
        <li>(2) Navigate existing user with new change</li>
      </ul>
    </td>
  </tr>
</table>
"""

print("DEFAULT:")
print(markdownify.markdownify(html))

class CustomConverter(markdownify.MarkdownConverter):
    def convert_td(self, el, text, convert_as_inline):
        # Convert all newlines to <br> to prevent breaking table
        text = text.strip()
        text = text.replace('\n', '<br>')
        return ' ' + text + ' |'
        
    def convert_li(self, el, text, convert_as_inline):
        # Check if inside table
        parent = el.parent
        while parent:
            if parent.name in ['td', 'th']:
                return f"- {text.strip()}<br>"
            parent = parent.parent
        return super().convert_li(el, text, convert_as_inline)
        
    def convert_p(self, el, text, convert_as_inline):
        parent = el.parent
        while parent:
            if parent.name in ['td', 'th']:
                return f"{text.strip()}<br><br>"
            parent = parent.parent
        return super().convert_p(el, text, convert_as_inline)

print("\nCUSTOM:")
print(CustomConverter().convert(html))
