#!/usr/bin/env python3
"""Select a database digest from the observed image and deployed repository.

Containerd may synthesize RepoDigests for local tags. These values identify
content, not registry publication or reachability. The deployed database must
come from a registry retained and accessible for recovery; this offline helper
only binds its repository to the image actually used by the container.
"""
import json
import re
import sys


def normalized_reference(value):
    """Return canonical repository and optional sha256 for supported Docker refs.

    Follow Docker's familiar-name, Docker Hub/library and legacy index.docker.io
    rules. Registry ports belong to the domain; tags belong to the last path
    component. Bare local image IDs cannot supply a repository identity.
    """
    if (not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9._:/@-]+', value)
            or re.fullmatch(r'(?:sha256:)?[a-f0-9]{64}', value)):
        raise ValueError('The deployed database reference must name a valid repository, not a local image ID')
    name, separator, digest = value.partition('@')
    if separator and not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('The database reference has an invalid sha256 digest')
    if name.rfind(':') > name.rfind('/'):
        name, tag = name.rsplit(':', 1)
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', tag):
            raise ValueError('The database reference has an invalid tag')
    first, slash, remainder = name.partition('/')
    if slash and (first == 'localhost' or '.' in first or ':' in first or first.lower() != first):
        domain, path = first.lower(), remainder
    else:
        domain, path = 'docker.io', name
    if domain == 'index.docker.io':
        domain = 'docker.io'
    if domain == 'docker.io' and '/' not in path:
        path = 'library/' + path
    label = r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
    component = r'[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*'
    if (not re.fullmatch(label + r'(?:\.' + label + r')*(?::[0-9]+)?', domain)
            or not re.fullmatch(component + r'(?:/' + component + r')*', path)):
        raise ValueError('The database reference has an invalid repository')
    return domain + '/' + path, digest if separator else None


def select_database_reference(deployed_reference, repo_digests):
    repository, pinned_digest = normalized_reference(deployed_reference)
    if not isinstance(repo_digests, list) or any(not isinstance(value, str) for value in repo_digests):
        raise ValueError('Docker must return a JSON list of image digest references')
    matching = set()
    for value in repo_digests:
        try:
            candidate_repository, candidate_digest = normalized_reference(value)
        except ValueError:
            continue
        if candidate_repository == repository and candidate_digest is not None:
            matching.add(candidate_digest)
    if pinned_digest is not None:
        if pinned_digest not in matching:
            raise ValueError('The deployed database digest is absent from its observed repository; preserve the exact registry image before backup')
        selected = pinned_digest
    else:
        if not matching:
            raise ValueError('No observed registry digest matches the deployed database repository; preserve its registry reference before backup')
        if len(matching) != 1:
            raise ValueError('The database repository has multiple observed digests; deploy an explicit repository@sha256 digest before backup')
        selected = next(iter(matching))
    # Keep Docker's familiar representation and the existing archive format.
    familiar = repository.removeprefix('docker.io/') if repository.startswith('docker.io/') else repository
    if repository.startswith('docker.io/library/') and familiar.count('/') == 1:
        familiar = familiar.removeprefix('library/')
    result = familiar + '@' + selected
    if len(result) > 255:
        raise ValueError('The supported database repository digest must be at most 255 characters')
    return result


def main():
    if len(sys.argv) != 2:
        raise ValueError('Supply the deployed database reference and its observed RepoDigests JSON on stdin')
    encoded = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(encoded) > 1024 * 1024:
        raise ValueError('The image digest observation exceeds its supported size')
    try:
        observation = json.loads(encoded)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Docker returned malformed image digest JSON') from None
    print(select_database_reference(sys.argv[1], observation))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        message = str(error) if isinstance(error, ValueError) else 'Unable to read the image digest observation'
        raise SystemExit('Backup database image selection failed: ' + message + '. No writers were stopped.') from None
