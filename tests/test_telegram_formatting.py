from __future__ import annotations

import unittest

from app.core.output import clean_user_visible_text
from app.channels.telegram.formatting import render_telegram_html


class TelegramFormattingTests(unittest.TestCase):
    def test_markdown_reply_is_rendered_as_telegram_html(self):
        text = (
            "**Stock Cover Loss** là tính năng gì?\n\n"
            "* **Mục tiêu:** Giảm rào cản.\n"
            "* Luồng: voucher $\\rightarrow$ trade.\n"
        )

        rendered = render_telegram_html(text)

        self.assertIn("<b>Stock Cover Loss</b>", rendered)
        self.assertIn("- <b>Mục tiêu:</b> Giảm rào cản.", rendered)
        self.assertIn("voucher -&gt; trade", rendered)
        self.assertNotIn("**", rendered)
        self.assertNotIn("$\\rightarrow$", rendered)
        self.assertNotIn("kb:", rendered)

    def test_user_html_is_escaped(self):
        rendered = render_telegram_html("<b>raw</b> & **safe**")

        self.assertIn("&lt;b&gt;raw&lt;/b&gt;", rendered)
        self.assertIn("&amp;", rendered)
        self.assertIn("<b>safe</b>", rendered)

    def test_sources_are_not_appended_for_telegram_user_text(self):
        user_text = clean_user_visible_text("OK\n\nNguồn:\n- [a.md](kb:a.md)\n- b.md")
        rendered = render_telegram_html(user_text)

        self.assertEqual(rendered, "OK")
        self.assertNotIn("Nguồn", rendered)


if __name__ == "__main__":
    unittest.main()
