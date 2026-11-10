#!/usr/bin/env python3
"""Scratch-only native topology witness; never launches Caddy/Next or accesses DB.

Private environment values are compared in memory only. No secret value or
secret digest is written to plans, contracts, receipts or stdout.
"""
import argparse
import ctypes
import datetime as dt
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit, unquote

class Refusal(Exception):
    def __init__(self, code, observations=None):
        self.code = code
        self.observations = observations or []
        super().__init__(code)

def require(condition, code):
    if not condition:
        raise Refusal(code)

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def json_digest(value):
    return hashlib.sha256(json.dumps(value, separators=(",", ":"), sort_keys=True).encode()).hexdigest()

def load(path):
    return json.loads(Path(path).read_text())

def write_new(path, value, mode=0o600):
    path = Path(path)
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.chmod(path, mode)

def identity(path):
    s = os.stat(path, follow_symlinks=False)
    require(stat.S_ISREG(s.st_mode), "NOT_REGULAR_FILE")
    return {"device": s.st_dev, "inode": s.st_ino, "bytes": s.st_size,
            "mtimeNs": s.st_mtime_ns, "mode": stat.S_IMODE(s.st_mode),
            "uid": s.st_uid, "gid": s.st_gid}

def public_origin(value):
    p = urlsplit(value)
    require(p.scheme == "http" and p.hostname == "127.0.0.1" and
            p.port is not None and p.port > 1024 and not p.username and
            not p.password and p.path in ("", "/") and not p.query and not p.fragment,
            "LOOPBACK_HTTP_ORIGIN_REQUIRED")
    return f"http://127.0.0.1:{p.port}"

def env_bytes(path):
    require(identity(path)["mode"] == 0o600, "PRIVATE_ENV_MODE_REQUIRED")
    return Path(path).read_bytes()

def env_names(data):
    return set(re.findall(rb"(?m)^([A-Z][A-Z0-9_]*)=", data))

PRIVILEGED_RUNTIME_ENV_NAMES = ("TEST_DATABASE_URL", "TEST_ADMIN_DATABASE_URL",
    "MIGRATION_DATABASE_URL", "BOOTSTRAP_ADMIN_*", "STAFF_ACCOUNTS_JSON", "STAFF_ACCOUNTS_B64")

def forbidden_environment_present(environ, forbidden):
    return any(name.startswith(key[:-1]) if key.endswith("*") else name == key
               for name in environ for key in forbidden)

def declared_environment(path):
    # Every declared fixture key is compared in memory, not merely identity keys.
    # Accept only the simple, generated env-file syntax actually used here; refuse
    # ambiguous syntax instead of silently skipping a potential policy variable.
    result = {}
    for line in env_bytes(path).decode().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        require(match is not None, "DECLARED_ENV_SYNTAX_UNSUPPORTED")
        key, value = match.groups()
        require(key not in result, "DUPLICATE_DECLARED_ENV_KEY")
        value = value.strip()
        if value[:1] in ("\"", "'"):
            require(len(value) >= 2 and value[0] == value[-1] and value[0] not in value[1:-1],
                    "DECLARED_ENV_SYNTAX_UNSUPPORTED")
            require(value[0] != '"' or "\\" not in value,
                    "DECLARED_ENV_SYNTAX_UNSUPPORTED")
            value = value[1:-1]
        else:
            require(not any(c in value for c in "#\"'"), "DECLARED_ENV_SYNTAX_UNSUPPORTED")
        result[key] = value
    return result

def trusted_derivative(data):
    require(len(re.findall(rb"(?m)^TRUST_PROXY=", data)) == 1, "PROXY_BOOLEAN_AMBIGUOUS")
    pattern = rb"(?m)^TRUST_PROXY=(?P<quote>['\"]?)false(?P=quote)(?=\r?$)"
    require(len(re.findall(pattern, data)) == 1,
            "ORIGINAL_PROXY_BOOLEAN_NOT_FALSE")
    return re.sub(pattern, lambda m: b"TRUST_PROXY=" + m.group("quote") + b"true" + m.group("quote"), data)

def caddy_derivative(data, upstream):
    require(data.count(b"reverse_proxy app:3000 {") == 1, "CADDY_UPSTREAM_AMBIGUOUS")
    require(data.count(b"{$SITE_ADDRESS} {") == 1, "CADDY_SITE_AMBIGUOUS")
    require(b"\tadmin off\n" in data and b"\tencode zstd gzip\n" in data and
            b"max_size 83951616" in data, "CADDY_POLICY_UNEXPECTED")
    hostport = urlsplit(upstream).netloc.encode()
    return data.replace(b"reverse_proxy app:3000 {", b"reverse_proxy " + hostport + b" {").replace(
        b"{$SITE_ADDRESS} {", b"{$SITE_ADDRESS} {\n\tbind 127.0.0.1")

def guarded_database_identity(runtime, harness):
    app, test = urlsplit(runtime["DATABASE_URL"]), urlsplit(harness["TEST_DATABASE_URL"])
    for value in (app, test):
        require(value.scheme in ("postgres", "postgresql") and
                value.hostname in ("127.0.0.1", "localhost", "::1") and
                not value.query and not value.fragment, "GUARDED_DATABASE_SCOPE_INVALID")
    require(test.hostname == app.hostname and (test.port or 5432) == (app.port or 5432)
            and test.path == app.path, "DATABASE_TARGET_MISMATCH")
    name = unquote(test.path[1:])
    require(re.fullmatch(r"(?:idealmakoo_test|idealmakoo_acceptance[0-9]*_[0-9]{13}_[a-f0-9]{8}|"
                         r"idealmakoo_repair_acceptance_[0-9]{13}_[a-f0-9]{6})", name),
            "GUARDED_DATABASE_NAME_INVALID")
    require(test.username != app.username, "RUNTIME_DATABASE_ROLE_NOT_SEPARATED")
    target = f"{test.hostname}:{test.port or 5432}/{name}"
    return {"databaseIdentity": hashlib.sha256(target.encode()).hexdigest(),
            "databaseNameSha256": hashlib.sha256(name.encode()).hexdigest()}

def prepare(a):
    project, out = Path(a.project).resolve(), Path(a.output).resolve()
    require(not out.exists(), "OUTPUT_ALREADY_EXISTS")
    origin, upstream = public_origin(a.origin), public_origin(a.upstream)
    require(origin != upstream, "PUBLIC_AND_UPSTREAM_PORTS_MUST_DIFFER")
    source = project / "deploy/caddy/Caddyfile"
    data = source.read_bytes()
    runtime, harness = Path(a.runtime_env).resolve(), Path(a.harness_env).resolve()
    originals = {"runtime": runtime, "harness": harness}
    original_data = {key: env_bytes(path) for key, path in originals.items()}
    derivatives = {key: trusted_derivative(value) for key, value in original_data.items()}
    inputs = load(a.inputs)
    require(inputs["buildId"] == a.build_id and inputs["inputFingerprint"] == a.input_fingerprint,
            "SOURCE_INPUT_RECEIPT_MISMATCH")
    out.mkdir(mode=0o700)
    os.chmod(out, 0o700)
    environments = {}
    for key, path in originals.items():
        target = out / f"audit.proxy.{key}.env"
        write_new(target, derivatives[key])
        environments[key] = {"original": str(path), "originalIdentity": identity(path),
                             "derived": str(target)}
        require(path.read_bytes() == original_data[key], "ORIGINAL_ENV_CHANGED_DURING_PREPARE")
    native = out / "Caddyfile.native"
    write_new(native, caddy_derivative(data, upstream))
    plan = {
        "format": "native-proxy-plan-v1", "createdAt": utc(), "activated": False,
        "project": str(project), "buildId": a.build_id, "inputFingerprint": a.input_fingerprint,
        "inputReceipt": str(Path(a.inputs).resolve()), "inputReceiptSha256": digest(a.inputs),
        "publicOrigin": origin, "upstreamOrigin": upstream,
        "productionCaddyfile": str(source), "productionCaddyfileSha256": digest(source),
        "nativeCaddyfile": str(native), "nativeCaddyfileSha256": digest(native),
        "environments": environments, "caddyUid": 10002, "caddyGid": 10002,
        "requiredCaddyEnvironmentNames": ["SITE_ADDRESS", "PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME"],
        "allowedCaddyEnvironmentNames": ["SITE_ADDRESS", "PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME"],
        "runtimeLaunchOverrides": {"PORT": str(urlsplit(upstream).port), "HOSTNAME": "127.0.0.1"},
        "environmentMutation": "Exactly one TRUST_PROXY=false line becomes true in each derivative; originals retained.",
        "configMutation": "Only app:3000 upstream substitution and bind 127.0.0.1 insertion.",
        "secretValuesOrSecretHashesStored": False,
        "coreConfigurationHashBindsProxy": False,
        "runtimeEnvironmentObservationScope": "Every declared runtime variable; explicit Next-only PORT/HOSTNAME overrides. Not arbitrary OS-environment equivalence.",
        "scope": "Native loopback HTTP proxy fidelity only; not TLS, H2, H3, WAN or full container isolation."
    }
    plan.update(guarded_database_identity(declared_environment(environments["runtime"]["derived"]),
                                         declared_environment(environments["harness"]["derived"])))
    write_new(out / "plan.json", plan)
    validate_plan(plan, full=True)
    print(json.dumps({"event": "prepared", "activated": False, "plan": str(out / "plan.json"),
                      "onlyEnvironmentKeyChanged": "TRUST_PROXY", "originalsPreserved": True,
                      "secretValuesOrHashesExported": False}))

def validate_plan(plan, full=False):
    require(digest(plan["inputReceipt"]) == plan["inputReceiptSha256"], "INPUT_RECEIPT_DRIFT")
    source = Path(plan["productionCaddyfile"]).read_bytes()
    require(digest(plan["productionCaddyfile"]) == plan["productionCaddyfileSha256"], "PRODUCTION_CADDYFILE_DRIFT")
    require(Path(plan["nativeCaddyfile"]).read_bytes() == caddy_derivative(source, plan["upstreamOrigin"]),
            "CADDY_DERIVATION_DRIFT")
    require(digest(plan["nativeCaddyfile"]) == plan["nativeCaddyfileSha256"], "NATIVE_CADDYFILE_DRIFT")
    envs = {}
    for key, refs in plan["environments"].items():
        require(identity(refs["original"]) == refs["originalIdentity"], "ORIGINAL_ENV_IDENTITY_DRIFT")
        require(env_bytes(refs["derived"]) == trusted_derivative(env_bytes(refs["original"])),
                "ENV_DERIVATION_DRIFT")
        envs[key] = declared_environment(refs["derived"])
    runtime, harness = envs["runtime"], envs["harness"]
    for value in envs.values():
        require(value.get("NODE_ENV") == "production" and value.get("TRUST_PROXY") == "true",
                "RUNTIME_POLICY_MISMATCH")
        require(value.get("SITE_URL") == plan["publicOrigin"] and
                value.get("NEXT_PUBLIC_SITE_URL") == plan["publicOrigin"], "PUBLIC_ORIGIN_CHANGED")
        require(len(value.get("SESSION_SECRET", "")) >= 32 and
                re.fullmatch("[0-9a-fA-F]{64}", value.get("MFA_ENCRYPTION_KEY", "")),
                "EXISTING_AUTH_KEY_INVALID")
    require(not forbidden_environment_present(runtime, PRIVILEGED_RUNTIME_ENV_NAMES) and
            "TEST_DATABASE_URL" in harness,
            "PRIVILEGED_RUNTIME_DATABASE_VARIABLE")
    for key in ("SESSION_SECRET", "MFA_ENCRYPTION_KEY", "DATABASE_URL"):
        require(runtime[key] == harness[key], "RUNTIME_HARNESS_IDENTITY_MISMATCH")
    db_identity = guarded_database_identity(runtime, harness)
    require(all(plan.get(k) == v for k, v in db_identity.items()), "GUARDED_DATABASE_IDENTITY_DRIFT")
    require((Path(plan["project"]) / ".next/BUILD_ID").read_text().strip() == plan["buildId"],
            "BUILD_ID_DRIFT")
    if full:
        inputs = load(plan["inputReceipt"])
        require(inputs["inputFingerprint"] == plan["inputFingerprint"] and
                inputs["buildId"] == plan["buildId"], "BUILD_INPUT_IDENTITY_MISMATCH")
        for relative, expected in inputs["files"].items():
            path = Path(plan["project"]) / relative
            require(path.stat().st_size == expected["bytes"] and digest(path) == expected["sha256"],
                    "APPLICATION_INPUT_DRIFT")
    return envs

def proc_basic(pid):
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
        fields = raw[raw.rfind(")") + 2:].split()
        status = {}
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                status[key] = value.strip()
        require(fields[0] not in ("Z", "X"), "OWNED_PROCESS_EXITED")
        return {"pid": pid, "startTicks": int(fields[19]),
                "uid": int(status["Uid"].split()[1]), "gid": int(status["Gid"].split()[1]),
                "capEffective": status.get("CapEff"), "capPermitted": status.get("CapPrm"),
                "capAmbient": status.get("CapAmb"), "noNewPrivileges": status.get("NoNewPrivs")}
    except FileNotFoundError:
        raise Refusal("OWNED_PROCESS_ABSENT")
    except PermissionError:
        raise Refusal("PROC_BASIC_PERMISSION_DENIED")

def owned_listeners(pid):
    inodes = set()
    try:
        for entry in Path(f"/proc/{pid}/fd").iterdir():
            try:
                target = os.readlink(entry)
            except FileNotFoundError:
                continue
            match = re.fullmatch(r"socket:\[([0-9]+)\]", target)
            if match:
                inodes.add(match.group(1))
        result = []
        for name, family in (("tcp", socket.AF_INET), ("tcp6", socket.AF_INET6)):
            for line in Path(f"/proc/{pid}/net/{name}").read_text().splitlines()[1:]:
                fields = line.split()
                if len(fields) < 10 or fields[3] != "0A" or fields[9] not in inodes:
                    continue
                address, port = fields[1].split(":")
                raw = bytes.fromhex(address)
                if family == socket.AF_INET:
                    raw = raw[::-1]
                else:
                    raw = b"".join(raw[i:i+4][::-1] for i in range(0, 16, 4))
                result.append({"host": socket.inet_ntop(family, raw), "port": int(port, 16)})
        return sorted(result, key=lambda value: (value["host"], value["port"]))
    except PermissionError:
        raise Refusal("PROC_LISTENER_PERMISSION_DENIED")

def raw_observation(pid, expected_env, forbidden, caddy_spec, full, process_role=None):
    require(process_role in (None, "caddy", "next", "worker"), "PROCESS_ROLE_INVALID")
    result = proc_basic(pid)
    try:
        exe = Path(f"/proc/{pid}/exe")
        result["exePath"] = os.readlink(exe)
        s = exe.stat()
        result["exeIdentity"] = {"device": s.st_dev, "inode": s.st_ino,
                                 "bytes": s.st_size, "mtimeNs": s.st_mtime_ns}
        if full:
            result["exeSha256"] = digest(exe)
    except PermissionError:
        raise Refusal("PROC_EXE_PERMISSION_DENIED")
    try:
        argv = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        argv = [v.decode() for v in argv if v]
        result["argvSha256"] = hashlib.sha256(b"\0".join(v.encode() for v in argv)).hexdigest()
        raw = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
        environ = dict(v.decode().split("=", 1) for v in raw if b"=" in v)
    except PermissionError:
        raise Refusal("PROC_ENV_PERMISSION_DENIED")
    require(all(environ.get(k) == v for k, v in expected_env.items()), "PROCESS_START_ENV_MISMATCH")
    require(not forbidden_environment_present(environ, forbidden), "PRIVILEGED_ENV_IN_RUNTIME_PROCESS")
    result["expectedEnvironmentMatches"] = True
    result["forbiddenEnvironmentAbsent"] = True
    result["listeners"] = owned_listeners(pid)
    if caddy_spec:
        allowed = set(caddy_spec["allowedEnvironmentNames"])
        require(set(environ) <= allowed, "CADDY_ENV_NOT_MINIMAL")
        require(all(k in environ for k in caddy_spec["requiredEnvironmentNames"]),
                "CADDY_ENV_REQUIRED_NAME_MISSING")
        require(argv == [caddy_spec["binary"], "run", "--config", caddy_spec["config"]],
                "CADDY_RUN_COMMAND_MISMATCH")
        require(result["uid"] == 10002 and result["gid"] == 10002 and
                result["noNewPrivileges"] == "1" and
                all(int(result.get(k) or "1", 16) == 0
                    for k in ("capEffective", "capPermitted", "capAmbient")),
                "CADDY_PRIVILEGE_POLICY_MISMATCH")
        result["minimalEnvironmentConfirmed"] = True
        require(result["listeners"] == [{"host": "127.0.0.1",
                "port": urlsplit(expected_env["SITE_ADDRESS"]).port}], "CADDY_LISTENER_DRIFT")
    elif process_role == "next":
        require(expected_env.get("HOSTNAME") == "127.0.0.1" and "PORT" in expected_env and
                result["listeners"] == [{"host": "127.0.0.1", "port": int(expected_env["PORT"])}],
                "NEXT_LISTENER_DRIFT")
    elif process_role == "worker":
        require(result["listeners"] == [], "WORKER_UNEXPECTED_LISTENER")
    return result

def observe(pid, expected_env, forbidden=(), caddy_spec=None, full=False, process_role=None):
    """Record a direct denial, then optionally perform a real same-UID read."""
    observations = []
    try:
        result = raw_observation(pid, expected_env, forbidden, caddy_spec, full, process_role)
        result["observationMethods"] = [{"method": "direct", "success": True}]
        return result
    except Refusal as exc:
        if exc.code not in ("PROC_EXE_PERMISSION_DENIED", "PROC_ENV_PERMISSION_DENIED",
                            "PROC_LISTENER_PERMISSION_DENIED"):
            raise
        observations.append({"method": "direct", "success": False, "errorCode": exc.code})
    basic = proc_basic(pid)
    require(os.geteuid() == 0 and basic["uid"] != 0, "SAME_UID_OBSERVER_UNAVAILABLE")
    read_fd, write_fd = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(read_fd)
        try:
            os.setgroups([])
            os.setgid(basic["gid"])
            os.setuid(basic["uid"])
            require(ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) == 0,
                    "OBSERVER_NO_NEW_PRIVILEGES_FAILED")
            result = raw_observation(pid, expected_env, forbidden, caddy_spec, full, process_role)
            payload = {"success": True, "result": result, "observerUid": os.geteuid()}
        except Refusal as exc:
            payload = {"success": False, "errorCode": exc.code}
        except Exception:
            payload = {"success": False, "errorCode": "SAME_UID_OBSERVATION_FAILED"}
        os.write(write_fd, json.dumps(payload).encode())
        os.close(write_fd)
        os._exit(0)
    os.close(write_fd)
    chunks = []
    while True:
        block = os.read(read_fd, 8192)
        if not block:
            break
        chunks.append(block)
        require(sum(map(len, chunks)) <= 65536, "OBSERVER_OUTPUT_TOO_LARGE")
    os.close(read_fd)
    _, status = os.waitpid(child, 0)
    require(os.waitstatus_to_exitcode(status) == 0, "SAME_UID_OBSERVER_EXITED")
    payload = json.loads(b"".join(chunks))
    if not payload.get("success"):
        code = payload.get("errorCode", "SAME_UID_OBSERVATION_FAILED")
        raise Refusal(code, observations + [{"method": "same-uid-fork", "success": False,
                                            "errorCode": code}])
    require(payload["observerUid"] == basic["uid"], "OBSERVER_UID_MISMATCH")
    result = payload["result"]
    result["observationMethods"] = observations + [{"method": "same-uid-fork", "success": True,
                                                   "observerUid": basic["uid"]}]
    return result

def process_spec(contract, role, envs):
    require(role in ("caddy", "next", "worker"), "PROCESS_ROLE_INVALID")
    if role == "caddy":
        return (contract["caddyEnvironment"], [],
                {"binary": contract["binary"]["path"], "config": contract["adaptedConfig"]["path"],
                 "allowedEnvironmentNames": list(contract["caddyEnvironment"]),
                 "requiredEnvironmentNames": contract["plan"]["requiredCaddyEnvironmentNames"]})
    expected = dict(envs["runtime"])
    if role == "next":
        expected.update(contract["plan"]["runtimeLaunchOverrides"])
    return expected, PRIVILEGED_RUNTIME_ENV_NAMES, None

def validate_extraction_provenance(path, binary, image_id, version):
    receipt = load(path)
    require(receipt.get("format") == "idealmakoo-caddy-extraction-v1" and
            receipt.get("status") == "passed", "CADDY_EXTRACTION_RECEIPT_INVALID")
    for key in ("byteIdentityVerifiedSourceGuestHost", "sourceContainerAndImagePinned",
                "sourceImageAndContainerNotModified"):
        require(receipt.get(key) is True, "CADDY_EXTRACTION_BINDING_INVALID")
    require(receipt.get("downloaded") is False, "CADDY_EXTRACTION_DOWNLOAD_NOT_ALLOWED")
    source, host = receipt.get("source"), receipt.get("hostCopy")
    require(isinstance(source, dict) and isinstance(host, dict), "CADDY_EXTRACTION_RECEIPT_INVALID")
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", image_id) and
            source.get("imageId") == image_id and source.get("binaryPath") == "/usr/bin/caddy",
            "CADDY_EXTRACTION_IMAGE_MISMATCH")
    require(isinstance(source.get("repositoryDigests"), list) and
            all(isinstance(value, str) and re.fullmatch(r"[^\s]+@sha256:[a-f0-9]{64}", value)
                for value in source["repositoryDigests"]), "CADDY_EXTRACTION_DIGESTS_INVALID")
    file_id, file_sha = identity(binary), digest(binary)
    with open(binary, "rb") as file:
        header = file.read(20)
    require(len(header) == 20 and header[:6] == b"\x7fELF\x02\x01" and
            int.from_bytes(header[18:20], "little") == 62, "CADDY_BINARY_ARCHITECTURE_MISMATCH")
    for item in (source, host):
        require(item.get("sha256") == file_sha and type(item.get("bytes")) is int and
                item["bytes"] == file_id["bytes"] and item.get("version") == version,
                "CADDY_EXTRACTION_BINARY_MISMATCH")
        require(type(item.get("elfClass")) is int and item["elfClass"] == 64 and
                type(item.get("elfMachine")) is int and item["elfMachine"] == 62,
                "CADDY_EXTRACTION_ARCHITECTURE_MISMATCH")
        permissions = item.get("permissions")
        require(isinstance(permissions, dict) and
                all(type(permissions.get(key)) is int for key in ("mode", "uid", "gid")),
                "CADDY_EXTRACTION_PERMISSION_INVALID")
    require(all(host["permissions"][key] == file_id[key] for key in ("mode", "uid", "gid")),
            "CADDY_EXTRACTION_HOST_PERMISSION_MISMATCH")
    require(host.get("securityCapabilityXattrPresent") is False and
            "security.capability" not in os.listxattr(binary), "CADDY_EXTRACTION_HOST_CAPABILITY_INVALID")
    capability = source.get("capabilities")
    require(isinstance(capability, dict) and capability.get("observed") is True and
            isinstance(capability.get("present"), bool), "CADDY_EXTRACTION_SOURCE_CAPABILITY_UNOBSERVED")
    require((capability["present"] is False and capability.get("rawHex") is None) or
            (capability["present"] is True and isinstance(capability.get("rawHex"), str) and
             re.fullmatch(r"(?:[a-f0-9]{2})+", capability["rawHex"])),
            "CADDY_EXTRACTION_SOURCE_CAPABILITY_INVALID")
    return {"provenanceReceiptSha256": digest(path), "sourceImageId": source["imageId"],
            "provenanceIdentityValidated": True}

def verify(contract, expected_sha=None, contract_path=None, full=False):
    if expected_sha is not None:
        require(digest(contract_path) == expected_sha, "TOPOLOGY_CONTRACT_DRIFT")
    require(os.readlink("/proc/self/ns/pid") == contract["nativePidNamespace"],
            "PROCESS_NAMESPACE_MISMATCH")
    envs = validate_plan(contract["plan"], full=full)
    require(digest(contract["adaptedConfig"]["path"]) == contract["adaptedConfig"]["sha256"],
            "ADAPTED_CADDY_CONFIG_DRIFT")
    require(identity(contract["binary"]["path"]) == contract["binary"]["fileIdentity"],
            "CADDY_BINARY_FILE_DRIFT")
    require(digest(contract["binary"]["provenanceReceiptPath"]) ==
            contract["binary"]["provenanceReceiptSha256"], "CADDY_PROVENANCE_RECEIPT_DRIFT")
    if full:
        require(digest(contract["binary"]["path"]) == contract["binary"]["sha256"], "CADDY_BINARY_DRIFT")
    witnessed = {}
    for role, expected in contract["processes"].items():
        env, forbidden, caddy_spec = process_spec(contract, role, envs)
        actual = observe(expected["pid"], env, forbidden, caddy_spec, full=full, process_role=role)
        for key in ("pid", "startTicks", "uid", "gid", "exeIdentity", "argvSha256", "listeners"):
            require(actual[key] == expected[key], "OWNED_PROCESS_IDENTITY_DRIFT")
        if full:
            require(actual["exeSha256"] == expected["exeSha256"], "OWNED_EXECUTABLE_DRIFT")
        witnessed[role] = actual
    return {"checkedAt": utc(), "passed": True, "fullCheck": full,
            "observations": {role: value["observationMethods"] for role, value in witnessed.items()},
            "secretValuesOrHashesExported": False}

def seal(a):
    require(os.readlink("/proc/self/ns/pid") == a.native_pid_namespace,
            "PROCESS_NAMESPACE_MISMATCH")
    nspid = next(line for line in Path("/proc/self/status").read_text().splitlines()
                 if line.startswith("NSpid:"))
    require(len(nspid.split()) == 2, "NATIVE_PID_NAMESPACE_REQUIRED")
    plan = load(a.plan)
    envs = validate_plan(plan, full=True)
    binary, config = Path(a.binary).resolve(), Path(a.adapted_config).resolve()
    for path in (binary, config):
        file_id = identity(path)
        require(file_id["uid"] == 0 and not file_id["mode"] & 0o022,
                "CADDY_EXECUTABLE_OR_CONFIG_WRITABLE_BY_RUNTIME")
    require("security.capability" not in os.listxattr(binary), "CADDY_FILE_CAPABILITY_PRESENT")
    for path in (a.caddy_data_dir, a.caddy_config_dir):
        s = os.stat(path)
        require(stat.S_ISDIR(s.st_mode) and s.st_uid == 10002 and s.st_gid == 10002 and
                stat.S_IMODE(s.st_mode) == 0o700, "CADDY_DATA_DIRECTORY_POLICY_MISMATCH")
    minimal_env = {"SITE_ADDRESS": plan["publicOrigin"], "PATH": "/usr/bin:/bin"}
    adapted = subprocess.run([str(binary), "adapt", "--config", plan["nativeCaddyfile"],
                              "--adapter", "caddyfile"], env=minimal_env, capture_output=True,
                             timeout=20, check=False)
    require(adapted.returncode == 0, "CADDY_ADAPT_FAILED")
    require(json.loads(adapted.stdout) == load(config), "ADAPTED_CONFIG_NOT_EXACT_DERIVATIVE")
    effective = load(config)
    require(effective.get("admin", {}).get("disabled") is True, "CADDY_CONFIG_API_NOT_DISABLED")
    servers = effective.get("apps", {}).get("http", {}).get("servers", {})
    require(len(servers) == 1 and next(iter(servers.values())).get("listen") ==
            [urlsplit(plan["publicOrigin"]).netloc], "CADDY_LISTENER_NOT_EXACT_LOOPBACK")
    version = subprocess.run([str(binary), "version"], env=minimal_env, capture_output=True,
                             timeout=10, check=False)
    require(version.returncode == 0 and len(version.stdout) < 512, "CADDY_VERSION_FAILED")
    version_text = version.stdout.decode().strip()
    provenance = validate_extraction_provenance(a.provenance, binary, a.image_id, version_text)
    contract = {
        "format": "native-proxy-topology-contract-v1", "sealedAt": utc(),
        "nativePidNamespace": a.native_pid_namespace,
        "plan": plan, "planSha256": digest(a.plan),
        "coreConfigurationHashBindsProxy": False,
        "binary": {"path": str(binary), "sha256": digest(binary), "fileIdentity": identity(binary),
                   "version": version_text, "provenanceReceiptPath": str(Path(a.provenance).resolve()),
                   **provenance},
        "adaptedConfig": {"path": str(config), "sha256": digest(config)},
        "caddyEnvironment": {"SITE_ADDRESS": plan["publicOrigin"], "PATH": "/usr/bin:/bin",
                            "XDG_DATA_HOME": str(Path(a.caddy_data_dir).resolve()),
                            "XDG_CONFIG_HOME": str(Path(a.caddy_config_dir).resolve())},
        "processes": {}, "secretValuesOrSecretHashesStored": False,
        "guardSha256": digest(__file__),
        "driftPolicy": "Any failed phase is retained and excluded from final acceptance; no cross-topology resume."
    }
    require(len({a.caddy_pid, a.next_pid, a.worker_pid}) == 3, "OWNED_PROCESS_ROLES_NOT_DISTINCT")
    for role, pid in (("caddy", a.caddy_pid), ("next", a.next_pid), ("worker", a.worker_pid)):
        require(pid is not None and pid > 1, "OWNED_PROCESS_PID_REQUIRED")
        env, forbidden, caddy_spec = process_spec(contract, role, envs)
        contract["processes"][role] = observe(pid, env, forbidden, caddy_spec, full=True, process_role=role)
    require(contract["processes"]["caddy"]["exeSha256"] == contract["binary"]["sha256"],
            "RUNNING_CADDY_BINARY_MISMATCH")
    verify(contract, full=True)
    write_new(a.output, contract)
    print(json.dumps({"event": "sealed", "topologySha256": digest(a.output),
                      "buildId": plan["buildId"], "configurationApiDisabled": True,
                      "secretValuesOrHashesExported": False}))

def core_refs(directories, build_id):
    references = []
    for directory in directories:
        root = Path(directory)
        ref = {"directoryLabel": root.name, "files": {}}
        for name in ("manifest.json", "inventory.json", "summary.json", "EXPORT.json"):
            p = root / name
            if p.is_file():
                ref["files"][name] = {"sha256": digest(p), "bytes": p.stat().st_size}
        if (root / "manifest.json").is_file():
            m = load(root / "manifest.json")
            require(m.get("config", {}).get("buildId", m.get("buildId")) == build_id,
                    "CORE_MANIFEST_BUILD_MISMATCH")
            ref["coreConfigurationHash"] = m.get("configurationHash")
        if (root / "summary.json").is_file():
            s = load(root / "summary.json")
            ref["counts"] = {k: s[k] for k in
                ("expected", "attempted", "completed", "expectedHttpResponses",
                 "errors", "timeouts", "pending", "coverageComplete") if k in s}
        references.append(ref)
    return references

def safe_topology(contract, original_sha):
    """Strict derivative of a sealed record; does not assert current liveness."""
    require(contract.get("format") == "native-proxy-topology-contract-v1", "TOPOLOGY_FORMAT_INVALID")
    require(re.fullmatch("[a-f0-9]{64}", original_sha), "TOPOLOGY_HASH_REQUIRED")
    plan, binary = contract["plan"], contract["binary"]
    require(set(contract["processes"]) == {"caddy", "next", "worker"}, "TOPOLOGY_PROCESS_ROLES_INVALID")
    version = binary["version"]
    require(re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?(?: h1:[A-Za-z0-9+/=]+)?",
                         version), "CADDY_VERSION_FORMAT_INVALID")
    def sha(value):
        require(isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value), "IDENTITY_HASH_INVALID")
        return value
    process_records = {}
    for role, value in contract["processes"].items():
        methods = []
        for item in value["observationMethods"]:
            require(item["method"] in ("direct", "same-uid-fork") and isinstance(item["success"], bool),
                    "OBSERVATION_METHOD_INVALID")
            safe = {"method": item["method"], "success": item["success"]}
            if "errorCode" in item:
                require(item["errorCode"] in ("PROC_EXE_PERMISSION_DENIED", "PROC_ENV_PERMISSION_DENIED",
                                             "PROC_LISTENER_PERMISSION_DENIED"), "OBSERVATION_ERROR_INVALID")
                safe["errorCode"] = item["errorCode"]
            if "observerUid" in item:
                require(isinstance(item["observerUid"], int) and item["observerUid"] >= 0, "OBSERVER_UID_INVALID")
                safe["observerUid"] = item["observerUid"]
            methods.append(safe)
        boot = {k: value[k] for k in ("pid", "startTicks", "exeIdentity", "argvSha256")}
        process_records[role] = {
            "ownedProcessIdentitySha256": json_digest(boot), "executableSha256": sha(value["exeSha256"]),
            "uid": value["uid"], "gid": value["gid"], "listeners": [
                {"host": item["host"], "port": item["port"]} for item in value["listeners"]],
            "expectedEnvironmentMatches": value["expectedEnvironmentMatches"] is True,
            "forbiddenEnvironmentAbsent": value["forbiddenEnvironmentAbsent"] is True,
            "observationMethods": methods}
    return {
        "format": "native-proxy-topology-safe-derivative-v1", "exportedAt": utc(),
        "originalPrivateContractSha256": original_sha, "sealedAt": contract["sealedAt"],
        "buildId": plan["buildId"], "inputFingerprint": sha(plan["inputFingerprint"]),
        "sourceInputReceiptSha256": sha(plan["inputReceiptSha256"]),
        "guardedDatabaseIdentity": sha(plan["databaseIdentity"]),
        "databaseNameSha256": sha(plan["databaseNameSha256"]),
        "publicOrigin": public_origin(plan["publicOrigin"]), "upstreamOrigin": public_origin(plan["upstreamOrigin"]),
        "scope": "Native loopback HTTP proxy fidelity; not TLS, H2, H3, WAN or full container isolation.",
        "runtimeEnvironmentObservationScope": "Every declared runtime variable; explicit Next-only PORT/HOSTNAME overrides. Not arbitrary OS-environment equivalence.",
        "binary": {"sha256": sha(binary["sha256"]), "version": version,
                   "sourceImageId": binary["sourceImageId"],
                   "provenanceReceiptSha256": sha(binary["provenanceReceiptSha256"])},
        "configuration": {"productionCaddyfileSha256": sha(plan["productionCaddyfileSha256"]),
                          "nativeCaddyfileSha256": sha(plan["nativeCaddyfileSha256"]),
                          "adaptedJsonSha256": sha(contract["adaptedConfig"]["sha256"]),
                          "configurationApiDisabled": True,
                          "onlyNativeCaddyChanges": ["upstream-substitution", "loopback-bind"],
                          "onlyEnvironmentKeyChanged": "TRUST_PROXY"},
        "nativePidNamespace": contract["nativePidNamespace"], "processesAtSeal": process_records,
        "guardSha256": sha(contract["guardSha256"]),
        "coreConfigurationHashAloneBindsProxy": False,
        "phaseReceiptsRequiredForLaterContinuity": True,
        "omissions": {"environmentPathsValuesAndSecretHashes": True,
                      "rawProcessArgumentsAndPidNumbers": True,
                      "rawLogsPrivateReportsDomCookiesAndImages": True}
    }

def export_topology(a):
    require(digest(a.contract) == a.topology_sha256, "TOPOLOGY_CONTRACT_DRIFT")
    value = safe_topology(load(a.contract), a.topology_sha256)
    write_new(a.output, value)
    print(json.dumps({"event": "topology-safe-exported", "originalContractSha256": a.topology_sha256,
                      "safeDerivativeSha256": digest(a.output), "secretValuesOrHashesExported": False}))

def run_phase(a):
    require(re.fullmatch("[a-z0-9-]+", a.phase), "UNSAFE_PHASE_LABEL")
    directory = Path(a.receipt_dir)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    paths = {k: directory / f"{a.phase}.{k}" for k in
             ("stdout.log", "stderr.log", "command.json", "launch.json", "receipt.json")}
    require(not any(p.exists() for p in paths.values()), "PHASE_RECEIPT_ALREADY_EXISTS")
    started, clock = utc(), time.monotonic()
    child, contract, before, after, code = None, None, None, None, None
    drift, observations, received, forced, launch_attempted = None, [], [], False, False
    stop_started = None
    def stop(sig, _frame=None):
        nonlocal stop_started
        received.append(signal.Signals(sig).name)
        if child is not None and child.poll() is None:
            child.send_signal(sig)
            stop_started = stop_started or time.monotonic()
    old_handlers = {sig: signal.signal(sig, stop) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        contract = load(a.contract)
        require(re.fullmatch("[a-f0-9]{64}", a.topology_sha256), "TOPOLOGY_HASH_REQUIRED")
        require(digest(__file__) == contract["guardSha256"], "GUARD_IMPLEMENTATION_DRIFT")
        before = verify(contract, a.topology_sha256, a.contract, full=True)
        require(not received, "EXTERNAL_SIGNAL_BEFORE_LAUNCH")
        command = a.command[1:] if a.command[:1] == ["--"] else a.command
        require(command, "COMMAND_REQUIRED")
        env_file = contract["plan"]["environments"][a.environment]["derived"]
        require("--env-file=" + env_file in command, "EXPLICIT_PINNED_ENV_FILE_REQUIRED")
        app_keys = set()
        for entry in contract["plan"]["environments"].values():
            app_keys |= {key.decode() for key in env_names(env_bytes(entry["derived"]))}
        # Prevent an ambient app setting from overriding Node's explicit env-file.
        environment = {k: v for k, v in os.environ.items() if k not in app_keys}
        if a.environment == "harness":
            environment["LIGHTHOUSE_DISPOSABLE_AUTH_AUDIT"] = "true"
        write_new(paths["command.json"], {"argv": command, "cwd": contract["plan"]["project"],
                                         "environmentValuesStored": False})
        with paths["stdout.log"].open("xb") as out, paths["stderr.log"].open("xb") as err:
            os.chmod(paths["stdout.log"], 0o600)
            os.chmod(paths["stderr.log"], 0o600)
            launch_attempted = True
            child = subprocess.Popen(command, cwd=contract["plan"]["project"], env=environment,
                                     stdout=out, stderr=err, start_new_session=True)
            write_new(paths["launch.json"], {"pid": child.pid, "launchedAt": utc(),
                      "commandFileSha256": digest(paths["command.json"])})
            print(json.dumps({"event": "phase-start", "phase": a.phase, "startedAt": started,
                              "topologySha256": a.topology_sha256, "pid": child.pid}), flush=True)
            next_check = time.monotonic() + 5
            while child.poll() is None:
                now = time.monotonic()
                if now >= next_check and not drift:
                    try:
                        verify(contract, a.topology_sha256, a.contract, full=False)
                    except Refusal as exc:
                        drift = exc.code
                        observations = exc.observations
                        stop(signal.SIGTERM)
                    next_check = now + 5
                if stop_started and now - stop_started >= 60 and child.poll() is None:
                    child.kill()
                    forced = True
                time.sleep(0.2)
            code = child.wait()
    except Refusal as exc:
        drift = drift or exc.code
        observations = observations or exc.observations
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        drift = drift or "TOPOLOGY_OR_COMMAND_OBSERVATION_FAILED"
    finally:
        if child is not None and child.poll() is None:
            stop(signal.SIGTERM)
            try:
                code = child.wait(timeout=60)
            except subprocess.TimeoutExpired:
                child.kill()
                forced = True
                code = child.wait()
        elif child is not None:
            code = child.returncode
        if child is not None and contract is not None:
            try:
                after = verify(contract, a.topology_sha256, a.contract, full=True)
            except Refusal as exc:
                drift = drift or exc.code
                observations = observations or exc.observations
            except (OSError, ValueError, KeyError, subprocess.SubprocessError):
                drift = drift or "AFTER_PHASE_OBSERVATION_FAILED"
        refs = []
        try:
            if contract is not None:
                refs = core_refs(a.artifact_dir, contract["plan"]["buildId"])
        except Refusal as exc:
            drift = drift or exc.code
        except (OSError, ValueError, KeyError):
            drift = drift or "CORE_ARTIFACT_OBSERVATION_FAILED"
        receipt = {
            "format": "topology-bound-audit-phase-v1", "phase": a.phase, "kind": a.kind,
            "startedAt": started, "finishedAt": utc(), "durationSeconds": round(time.monotonic()-clock, 3),
            "topologySha256": a.topology_sha256,
            "buildId": contract["plan"]["buildId"] if contract else None,
            "commandLaunchAttempted": launch_attempted, "commandStarted": child is not None,
            "coreConfigurationHashAloneBindsProxy": False, "actualCommandExitCode": code,
            "validationPassed": drift is None, "validationErrorCode": drift,
            "failedObservationMethods": observations,
            "validationIsSeparateFromLighthouseOutcome": True,
            "receivedOrForwardedSignals": received, "wrapperForcedKillAfterSixtySeconds": forced,
            "interruptedPageCleanup": "Not inferred by this wrapper; retain the original auditor's evidence.",
            "before": before, "after": after, "artifacts": refs,
            "retainedPrivateCommandArtifacts": {name: {"sha256": digest(path), "bytes": path.stat().st_size}
                for name, path in paths.items() if name != "receipt.json" and path.exists()},
            "rawLogsRemainPrivate": True, "secretValuesOrHashesExported": False
        }
        write_new(paths["receipt.json"], receipt)
        print(json.dumps({"event": "phase-complete", "phase": a.phase,
                          "actualCommandExitCode": code, "validationPassed": drift is None,
                          "validationErrorCode": drift, "durationSeconds": receipt["durationSeconds"],
                          "receiptSha256": digest(paths["receipt.json"])}), flush=True)
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
    return 72 if drift else code if code is not None and code >= 0 else 128-code if code is not None else 72

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("prepare")
    for name in ("project", "runtime-env", "harness-env", "output", "origin", "upstream",
                 "inputs", "build-id", "input-fingerprint"):
        p.add_argument("--" + name, required=True)
    p = sub.add_parser("seal")
    for name in ("plan", "binary", "adapted-config", "provenance", "image-id", "output",
                 "caddy-data-dir", "caddy-config-dir", "native-pid-namespace"):
        p.add_argument("--" + name, required=True)
    for name in ("caddy-pid", "next-pid", "worker-pid"):
        p.add_argument("--" + name, required=True, type=int)
    p = sub.add_parser("verify")
    p.add_argument("--contract", required=True)
    p.add_argument("--topology-sha256", required=True)
    p = sub.add_parser("export-topology")
    for name in ("contract", "topology-sha256", "output"):
        p.add_argument("--" + name, required=True)
    p = sub.add_parser("run")
    for name in ("contract", "topology-sha256", "phase", "receipt-dir"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--kind", choices=("fixtures", "inventory", "metadata", "scoring", "export"), required=True)
    p.add_argument("--environment", choices=("runtime", "harness"), required=True)
    p.add_argument("--artifact-dir", action="append", default=[])
    p.add_argument("command", nargs=argparse.REMAINDER)
    a = parser.parse_args()
    try:
        if a.action == "prepare":
            prepare(a)
        elif a.action == "seal":
            seal(a)
        elif a.action == "verify":
            print(json.dumps(verify(load(a.contract), a.topology_sha256, a.contract, full=True)))
        elif a.action == "export-topology":
            export_topology(a)
        else:
            return run_phase(a)
        return 0
    except Refusal as exc:
        print(json.dumps({"event": "refused", "errorCode": exc.code,
                          "observationMethods": exc.observations,
                          "secretValuesOrHashesExported": False}), file=sys.stderr)
        return 72
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        # Never print an exception which may contain private paths or contents.
        print(json.dumps({"event": "refused", "errorCode": "TOPOLOGY_OBSERVATION_FAILED",
                          "secretValuesOrHashesExported": False}), file=sys.stderr)
        return 72

if __name__ == "__main__":
    sys.exit(main())
