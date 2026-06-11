from __future__ import annotations

import unittest

from app.core.output import clean_user_visible_text


class OutputSanitizerTests(unittest.TestCase):
    def test_inline_kb_citation_is_removed(self):
        text = "Stock Cover Loss là package bù lỗ [Cover loss.md](kb:02. Context/Confluence/Stock/Cover loss.md)."

        cleaned = clean_user_visible_text(text)

        self.assertEqual(cleaned, "Stock Cover Loss là package bù lỗ.")
        self.assertNotIn("kb:", cleaned)
        self.assertNotIn("Cover loss.md", cleaned)

    def test_nested_bracket_kb_citation_label_is_removed(self):
        text = (
            "Scheme áp dụng cho all 1st trader "
            "[273532968_[Stock] 55. Cover loss.md](kb:02. Context/Confluence/Stock/Product Page/273532968_[Stock] 55. Cover loss.md)."
        )

        cleaned = clean_user_visible_text(text)

        self.assertEqual(cleaned, "Scheme áp dụng cho all 1st trader.")
        self.assertNotIn("kb:", cleaned)
        self.assertNotIn("[Stock]", cleaned)

    def test_trailing_source_block_is_removed(self):
        text = (
            "FD có kỳ hạn 1 tháng và 3 tháng.\n\n"
            "Nguồn:\n"
            "- 05. Knowledge/FD/FD.md\n"
            "- [FD spec](kb:05. Knowledge/FD/spec.md)"
        )

        cleaned = clean_user_visible_text(text)

        self.assertEqual(cleaned, "FD có kỳ hạn 1 tháng và 3 tháng.")

    def test_regular_source_word_is_preserved(self):
        text = "Nguồn tăng trưởng chính của Stock là activation và repeat trade."

        self.assertEqual(clean_user_visible_text(text), text)

    def test_zalopay_spelling_normalization(self):
        self.assertEqual(clean_user_visible_text("Chào mừng bạn đến ZaloPay và zalopay hoặc ZALOPAY!"), "Chào mừng bạn đến Zalopay và Zalopay hoặc Zalopay!")

    def test_paren_citation_without_slash_is_removed(self):
        text = "FD có kỳ hạn 1 tháng (FD.md)."
        self.assertEqual(clean_user_visible_text(text), "FD có kỳ hạn 1 tháng.")

    def test_bracket_citation_is_removed(self):
        text = "FD có kỳ hạn 1 tháng [FD.md]."
        self.assertEqual(clean_user_visible_text(text), "FD có kỳ hạn 1 tháng.")

    def test_source_url_marker_is_removed(self):
        text = "FD có kỳ hạn 1 tháng. Source: https://kb.local/05.Knowledge/FD.md"
        self.assertEqual(clean_user_visible_text(text), "FD có kỳ hạn 1 tháng.")


if __name__ == "__main__":
    unittest.main()
