# -*- coding: utf-8 -*-
"""Просмотрщик в настоящем браузере (пропускается, если нет playwright + chromium)."""
import pytest

pw = pytest.importorskip("playwright.sync_api")


def test_viewer_in_browser(synth_run):
    path = (synth_run["out_dir"] / "viewer.html").resolve()
    try:
        with pw.sync_playwright() as p:
            b = p.chromium.launch()
            page = b.new_page(viewport={"width": 1300, "height": 800})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(path.as_uri())
            page.wait_for_timeout(2500)
            assert "узлов на схеме" in page.inner_text("#status")
            gid = str(int(synth_run["top"].gid.iloc[0]))
            page.fill("#q", gid)
            page.press("#q", "Enter")
            page.wait_for_timeout(1500)
            assert gid in page.inner_text("#card")
            assert "роль:" in page.inner_text("#card")
            ids = " ".join(str(int(x)) for x in synth_run["top"].gid.head(5))
            page.fill("#qq", ids)
            page.click("#bUp")
            page.wait_for_timeout(1000)
            assert page.inner_text("#qres").strip()
            page.fill("#q", "123")
            page.on("dialog", lambda d: d.dismiss())
            page.press("#q", "Enter")
            b.close()
    except Exception as ex:                      # нет браузера — не ошибка кода
        if "Executable doesn't exist" in str(ex) or "browserType.launch" in str(ex):
            pytest.skip(f"chromium недоступен: {ex}")
        raise
    assert not errors, errors
