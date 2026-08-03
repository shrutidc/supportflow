from app.redact import redact


class TestSecretsAlwaysGo:
    """Secrets are removed in every mode, including `off`. Sending a live
    credential to a third party is not a configurable trade-off."""

    def test_vendor_api_keys(self):
        text = "my key is sk_live_abcdefghijklmnop and it stopped working"
        assert "sk_live_abcdefghijklmnop" not in redact(text, "off")
        assert "[REDACTED_API_KEY]" in redact(text, "off")

    def test_google_and_github_keys(self):
        assert "AIza" not in redact("key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6", "standard")
        assert "ghp_" not in redact("token ghp_1234567890abcdefghij", "standard")

    def test_jwt(self):
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r"
        assert jwt not in redact(f"bearer {jwt}", "off")

    def test_card_number(self):
        assert "4111 1111 1111 1111" not in redact("card 4111 1111 1111 1111", "standard")

    def test_labelled_password(self):
        out = redact("password: hunter2please", "standard")
        assert "hunter2please" not in out

    def test_private_key_block(self):
        block = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKC\n-----END RSA PRIVATE KEY-----"
        assert "MIIEowIBAAKC" not in redact(block, "off")


class TestPiiIsConfigurable:
    """A customer's own email is often the context that makes a ticket
    answerable, so removing it is opt-in rather than default."""

    def test_standard_keeps_contact_details(self):
        text = "reach me at ada@example.com"
        assert "ada@example.com" in redact(text, "standard")

    def test_strict_removes_them(self):
        assert "ada@example.com" not in redact("reach me at ada@example.com", "strict")

    def test_strict_removes_phone_numbers(self):
        assert "+1 415 555 0132" not in redact("call +1 415 555 0132", "strict")


class TestLeavesOrdinaryTextAlone:
    def test_normal_ticket_survives_intact(self):
        text = "The dashboard shows a 404 after I click Export. Tried Chrome and Safari."
        assert redact(text, "standard") == text

    def test_empty_string(self):
        assert redact("", "standard") == ""

    def test_short_numbers_are_not_cards(self):
        text = "error code 500 on order 12345"
        assert redact(text, "standard") == text
