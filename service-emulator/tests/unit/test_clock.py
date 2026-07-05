"""Synthetic-clock helpers: parse_as_of accepts several input shapes and normalizes."""

from service_emulator.clock import DEFAULT_AS_OF_ISO, parse_as_of


def test_empty_returns_default():
    assert parse_as_of(None) == DEFAULT_AS_OF_ISO
    assert parse_as_of("") == DEFAULT_AS_OF_ISO


def test_date_only_becomes_end_of_day_pacific():
    assert parse_as_of("2026-05-21") == "2026-05-21T23:59:59-07:00"


def test_datetime_without_tz_assumes_pacific():
    assert parse_as_of("2026-05-21T07:00:00") == "2026-05-21T07:00:00-07:00"


def test_datetime_without_seconds_assumes_pacific():
    assert parse_as_of("2026-05-21T07:00") == "2026-05-21T07:00:00-07:00"


def test_datetime_with_tz_passes_through():
    assert parse_as_of("2026-05-21T07:00:00-07:00") == "2026-05-21T07:00:00-07:00"
    assert parse_as_of("2026-05-21T14:00:00Z") == "2026-05-21T14:00:00Z"
