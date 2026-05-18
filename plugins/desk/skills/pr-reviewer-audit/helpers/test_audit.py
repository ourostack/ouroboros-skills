"""Smoke test for ``audit`` — verifies CLI shape, tenant preamble, and
return contract without making real ADO / az calls.

The test suite is intentionally thin: it covers the interface
contract from SKILL.md (``parse_args`` accepts 4 positional args;
``ensure_tenant`` runs before any ADO request; ``main`` returns a
dict with the documented keys). Integration against a real PR is a
documented manual-verify step, not automated.

Run from this directory with:

    python -m pytest test_audit.py
"""

from __future__ import annotations

import logging
import sys
import unittest.mock as _mock
from pathlib import Path


HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def test_module_imports_cleanly() -> None:
    """``audit`` imports without raising."""
    import audit  # noqa: F401


def test_parse_args_accepts_four_positional_args() -> None:
    """``parse_args`` accepts (org, project, repo-guid, pr-id) in order."""
    import audit

    ns = audit.parse_args(["my-org", "my-project", "repo-guid", "123"])
    assert ns.org == "my-org"
    assert ns.project == "my-project"
    assert ns.repo_id == "repo-guid"
    assert ns.pr_id == "123"


def test_ensure_tenant_runs_before_any_ado_request() -> None:
    """``ensure_tenant`` must be called before any ADO HTTP request.

    Spy on ``subprocess.run`` (used by the tenant sniff) and
    ``requests.get`` (used by the ADO REST calls); assert the spy on
    subprocess fires at least once before the spy on requests.
    """
    import audit

    call_order: list[str] = []

    class _FakeCompleted:
        returncode = 0
        stdout = "microsoft.onmicrosoft.com\n"
        stderr = ""

    def _fake_run(*args, **kwargs):  # type: ignore[no-untyped-def]
        call_order.append("subprocess.run")
        return _FakeCompleted()

    class _FakeResp:
        status_code = 200

        @staticmethod
        def json():  # type: ignore[no-untyped-def]
            return {"value": [], "reviewers": [], "count": 0}

        @staticmethod
        def raise_for_status():  # type: ignore[no-untyped-def]
            return None

    def _fake_get(*args, **kwargs):  # type: ignore[no-untyped-def]
        call_order.append("requests.get")
        return _FakeResp()

    with _mock.patch.object(audit.subprocess, "run", side_effect=_fake_run), _mock.patch.object(
        audit.requests, "get", side_effect=_fake_get
    ):
        result = audit.main("org", "project", "repo-guid", "123")

    assert call_order, "no calls observed"
    assert call_order[0] == "subprocess.run", (
        "ensure_tenant (subprocess.run) must run before any ADO request (requests.get); "
        f"observed order: {call_order}"
    )
    assert isinstance(result, dict)


def test_main_returns_documented_shape() -> None:
    """``main`` returns a dict with the two keys documented in
    SKILL.md: ``file_to_groups`` (dict) and ``approver_ranking``
    (list)."""
    import audit

    class _FakeCompleted:
        returncode = 0
        stdout = "microsoft.onmicrosoft.com\n"
        stderr = ""

    class _FakeResp:
        status_code = 200

        @staticmethod
        def json():  # type: ignore[no-untyped-def]
            return {"value": [], "reviewers": [], "count": 0}

        @staticmethod
        def raise_for_status():  # type: ignore[no-untyped-def]
            return None

    with _mock.patch.object(audit.subprocess, "run", return_value=_FakeCompleted()), _mock.patch.object(
        audit.requests, "get", return_value=_FakeResp()
    ):
        result = audit.main("org", "project", "repo-guid", "123")

    assert set(result.keys()) == {"file_to_groups", "approver_ranking"}
    assert isinstance(result["file_to_groups"], dict)
    assert isinstance(result["approver_ranking"], list)


def test_ensure_tenant_mismatch_logs_warning(caplog) -> None:  # type: ignore[no-untyped-def]
    """On a mismatched tenant, ``ensure_tenant`` logs a warning and
    returns a sentinel. The branch is exercised; return/raise shape
    is an implementation choice documented in SKILL.md."""
    import audit

    class _FakeCompleted:
        returncode = 0
        stdout = "contoso.onmicrosoft.com\n"
        stderr = ""

    with _mock.patch.object(audit.subprocess, "run", return_value=_FakeCompleted()):
        with caplog.at_level(logging.WARNING, logger=audit.__name__):
            result = audit.ensure_tenant()

    assert result is False or result == "mismatch" or isinstance(result, tuple), (
        f"ensure_tenant must return a falsy sentinel on mismatch; got {result!r}"
    )
    assert any("tenant" in record.message.lower() for record in caplog.records), (
        "ensure_tenant mismatch must log a warning mentioning 'tenant'"
    )


def test_ensure_tenant_az_command_failure_returns_false(caplog) -> None:  # type: ignore[no-untyped-def]
    """``ensure_tenant`` returns False on az-command non-zero exit."""
    import audit

    class _FakeFailed:
        returncode = 1
        stdout = ""
        stderr = "az: command not found\n"

    with _mock.patch.object(audit.subprocess, "run", return_value=_FakeFailed()):
        with caplog.at_level(logging.WARNING, logger=audit.__name__):
            result = audit.ensure_tenant()

    assert result is False
    assert any("az account show failed" in record.message for record in caplog.records)


def test_scope_matches_all_kinds() -> None:
    """``_scope_matches`` handles Exact, Prefix, DefaultBranch, and
    missing-path scopes."""
    import audit

    # Exact
    assert audit._scope_matches({"matchKind": "Exact", "path": "/a.cs"}, "/a.cs") is True
    assert audit._scope_matches({"matchKind": "Exact", "path": "/a.cs"}, "/b.cs") is False
    # Prefix
    assert audit._scope_matches({"matchKind": "Prefix", "path": "/src/"}, "/src/a.cs") is True
    assert audit._scope_matches({"matchKind": "Prefix", "path": "/src/"}, "/other.cs") is False
    # DefaultBranch (always true)
    assert audit._scope_matches({"matchKind": "DefaultBranch", "path": "/main"}, "/any") is True
    # Empty path (always true)
    assert audit._scope_matches({"matchKind": "Exact", "path": ""}, "/anything") is True
    # Unknown matchKind (False)
    assert audit._scope_matches({"matchKind": "NovelKind", "path": "/x"}, "/x") is False


def test_build_file_to_groups_collects_required_ids() -> None:
    """``_build_file_to_groups`` maps each file to the union of
    required-reviewer IDs from every matching policy scope."""
    import audit

    policies = [
        {
            "settings": {
                "scope": [{"matchKind": "Prefix", "path": "/Src/Common/"}],
                "requiredReviewerIds": ["group-common-owners", "group-dto-reviewers"],
            }
        },
        {
            "settings": {
                "scope": [{"matchKind": "Exact", "path": "/Src/Smb/Service.cs"}],
                "requiredReviewerIds": ["group-smb-reviewers"],
            }
        },
    ]
    files = ["/Src/Common/Model.cs", "/Src/Smb/Service.cs", "/Src/Other/Untouched.cs"]
    result = audit._build_file_to_groups(policies, files)

    assert set(result["/Src/Common/Model.cs"]) == {"group-common-owners", "group-dto-reviewers"}
    assert result["/Src/Smb/Service.cs"] == ["group-smb-reviewers"]
    assert result["/Src/Other/Untouched.cs"] == []


def test_build_approver_ranking_sorts_by_satisfies() -> None:
    """``_build_approver_ranking`` ranks reviewers whose ``votedFor[]``
    overlaps required groups ahead of those who satisfy nothing."""
    import audit

    pr_detail = {
        "reviewers": [
            {
                "displayName": "Solo Reviewer",
                "descriptor": "desc-a",
                "vote": 10,
                "votedFor": [{"id": "group-x"}],
            },
            {
                "displayName": "Dual Reviewer",
                "descriptor": "desc-b",
                "vote": 10,
                "votedFor": [{"id": "group-x"}, {"id": "group-y"}],
            },
            {
                "displayName": "Unrelated",
                "descriptor": "desc-c",
                "vote": 0,
                "votedFor": [],
            },
        ]
    }
    file_to_groups = {"/a": ["group-x", "group-y"]}
    ranking = audit._build_approver_ranking(pr_detail, file_to_groups)

    assert [r["displayName"] for r in ranking] == [
        "Dual Reviewer",
        "Solo Reviewer",
        "Unrelated",
    ]
    assert set(ranking[0]["satisfies"]) == {"group-x", "group-y"}
    assert ranking[2]["satisfies"] == []


def test_main_tenant_mismatch_returns_empty_sentinel() -> None:
    """When ``ensure_tenant`` returns False, ``main`` short-circuits
    with an empty result and does NOT make any ADO request."""
    import audit

    class _FakeFailed:
        returncode = 0
        stdout = "contoso.onmicrosoft.com\n"
        stderr = ""

    requests_calls: list[str] = []

    def _spy_get(*args, **kwargs):  # type: ignore[no-untyped-def]
        requests_calls.append("requests.get")
        raise AssertionError("no ADO request should fire after tenant mismatch")

    with _mock.patch.object(audit.subprocess, "run", return_value=_FakeFailed()), _mock.patch.object(
        audit.requests, "get", side_effect=_spy_get
    ):
        result = audit.main("org", "proj", "repo", "1")

    assert result == {"file_to_groups": {}, "approver_ranking": []}
    assert requests_calls == []


def test_main_token_failure_returns_empty_sentinel() -> None:
    """If ``_get_bearer_token`` raises (e.g., az not available), ``main``
    returns the empty sentinel without attempting ADO calls."""
    import audit

    # First subprocess.run call returns tenant-ok; the second (get-access-token)
    # returns non-zero so _get_bearer_token raises.
    seq: list[Any] = [
        _mock.Mock(returncode=0, stdout="microsoft.onmicrosoft.com\n", stderr=""),
        _mock.Mock(returncode=1, stdout="", stderr="az get-access-token failed\n"),
    ]
    requests_calls: list[str] = []

    def _spy_get(*args, **kwargs):  # type: ignore[no-untyped-def]
        requests_calls.append("requests.get")
        raise AssertionError("no ADO request should fire after token acquisition failure")

    with _mock.patch.object(audit.subprocess, "run", side_effect=seq), _mock.patch.object(
        audit.requests, "get", side_effect=_spy_get
    ):
        result = audit.main("org", "proj", "repo", "1")

    assert result == {"file_to_groups": {}, "approver_ranking": []}
    assert requests_calls == []


def test_main_with_live_fake_responses_runs_full_pipeline() -> None:
    """Exercise the happy-path through ``main`` with fake policies,
    iteration list, changes, and PR detail. Verifies the full 4-step
    recipe executes end-to-end including the file→group map build."""
    import audit

    subprocess_seq = [
        _mock.Mock(returncode=0, stdout="microsoft.onmicrosoft.com\n", stderr=""),
        _mock.Mock(returncode=0, stdout="fake-token\n", stderr=""),
    ]

    def _fake_get(url, *args, **kwargs):  # type: ignore[no-untyped-def]
        resp = _mock.Mock()
        resp.raise_for_status = _mock.Mock()
        if "policy/configurations" in url:
            resp.json = _mock.Mock(
                return_value={
                    "value": [
                        {
                            "isEnabled": True,
                            "isDeleted": False,
                            "type": {"id": audit.REQUIRED_REVIEWER_POLICY_TYPE_ID},
                            "settings": {
                                "scope": [{"matchKind": "Prefix", "path": "/Src/"}],
                                "requiredReviewerIds": ["group-a"],
                            },
                        },
                        {
                            "isEnabled": False,
                            "isDeleted": False,
                            "type": {"id": audit.REQUIRED_REVIEWER_POLICY_TYPE_ID},
                            "settings": {"scope": [], "requiredReviewerIds": ["skipped"]},
                        },
                    ]
                }
            )
        elif "/iterations?" in url:
            resp.json = _mock.Mock(return_value={"value": [{"id": 1}]})
        elif "/iterations/1/changes" in url:
            resp.json = _mock.Mock(
                return_value={
                    "changeEntries": [
                        {"item": {"path": "/Src/File.cs"}},
                        {"item": {}},  # no path — skipped
                    ]
                }
            )
        elif "/pullRequests/" in url:
            resp.json = _mock.Mock(
                return_value={
                    "reviewers": [
                        {
                            "displayName": "Alice",
                            "descriptor": "d",
                            "vote": 10,
                            "votedFor": [{"id": "group-a"}],
                        }
                    ]
                }
            )
        else:
            resp.json = _mock.Mock(return_value={})
        return resp

    with _mock.patch.object(audit.subprocess, "run", side_effect=subprocess_seq), _mock.patch.object(
        audit.requests, "get", side_effect=_fake_get
    ):
        result = audit.main("org", "proj", "repo", "42")

    assert result["file_to_groups"] == {"/Src/File.cs": ["group-a"]}
    assert len(result["approver_ranking"]) == 1
    assert result["approver_ranking"][0]["displayName"] == "Alice"
    assert result["approver_ranking"][0]["satisfies"] == ["group-a"]


def test_fetch_policies_filters_wrong_type_and_deleted() -> None:
    """``_fetch_required_reviewer_policies`` skips non-required-
    reviewer types and policies marked deleted."""
    import audit

    resp = _mock.Mock()
    resp.raise_for_status = _mock.Mock()
    resp.json = _mock.Mock(
        return_value={
            "value": [
                {
                    # Wrong type — triggers line 132 continue
                    "isEnabled": True,
                    "isDeleted": False,
                    "type": {"id": "wrong-type-id"},
                    "settings": {},
                },
                {
                    # Enabled but deleted — triggers line 136 continue
                    "isEnabled": True,
                    "isDeleted": True,
                    "type": {"id": audit.REQUIRED_REVIEWER_POLICY_TYPE_ID},
                    "settings": {},
                },
                {
                    "isEnabled": True,
                    "isDeleted": False,
                    "type": {"id": audit.REQUIRED_REVIEWER_POLICY_TYPE_ID},
                    "settings": {"scope": [], "requiredReviewerIds": ["kept"]},
                },
            ]
        }
    )

    with _mock.patch.object(audit.requests, "get", return_value=resp):
        result = audit._fetch_required_reviewer_policies(
            "o", "p", "r", {"Authorization": "Bearer x"}
        )

    assert len(result) == 1
    assert result[0]["settings"]["requiredReviewerIds"] == ["kept"]


def test_fetch_pr_files_no_iterations_returns_empty() -> None:
    """``_fetch_pr_files`` returns [] when the PR has zero iterations."""
    import audit

    resp = _mock.Mock()
    resp.raise_for_status = _mock.Mock()
    resp.json = _mock.Mock(return_value={"value": []})

    with _mock.patch.object(audit.requests, "get", return_value=resp):
        result = audit._fetch_pr_files("o", "p", "r", "1", {"Authorization": "Bearer x"})

    assert result == []


def test_fetch_pr_files_iteration_without_id_returns_empty() -> None:
    """``_fetch_pr_files`` returns [] when the latest iteration
    lacks an ``id`` field (malformed response defensive path)."""
    import audit

    resp = _mock.Mock()
    resp.raise_for_status = _mock.Mock()
    resp.json = _mock.Mock(return_value={"value": [{"name": "no-id"}]})

    with _mock.patch.object(audit.requests, "get", return_value=resp):
        result = audit._fetch_pr_files("o", "p", "r", "1", {"Authorization": "Bearer x"})

    assert result == []


def test_cli_main_prints_json_to_stdout(capsys) -> None:  # type: ignore[no-untyped-def]
    """``_cli_main`` parses argv, invokes ``main``, and prints JSON."""
    import audit

    with _mock.patch.object(
        audit, "main", return_value={"file_to_groups": {}, "approver_ranking": []}
    ):
        rc = audit._cli_main(["org", "proj", "repo", "42"])

    captured = capsys.readouterr()
    assert rc == 0
    assert '"file_to_groups"' in captured.out
    assert '"approver_ranking"' in captured.out


def test_module_run_as_main_exits_zero() -> None:
    """Covers the ``if __name__ == '__main__':`` guard at the bottom
    of audit.py. Uses runpy with a patched subprocess.run that forces
    the tenant-mismatch sentinel path — main() short-circuits without
    real network I/O."""
    import runpy

    original_argv = sys.argv[:]
    sys.argv = ["audit.py", "org", "proj", "repo", "42"]
    try:
        class _FakeFailed:
            returncode = 1
            stdout = ""
            stderr = "az not available\n"

        exited = False
        with _mock.patch("subprocess.run", return_value=_FakeFailed()):
            try:
                runpy.run_path(str(HERE / "audit.py"), run_name="__main__")
            except SystemExit as exc:
                exited = True
                assert exc.code == 0
        assert exited, "_cli_main should have raised SystemExit"
    finally:
        sys.argv = original_argv
