// Docker files have no extension to go by, so they are told apart by name. A Dockerfile is Dockerfile, Dockerfile.dev,
// api.Dockerfile or Containerfile (podman); a Compose file is [docker-]compose[.override|-dev].y[a]ml.
const DOCKERFILE = /^(?:.+\.)?(?:docker|container)file(?:\..+)?$/i;
const COMPOSE = /^(?:docker-)?compose(?:[.-].+)?\.ya?ml$/i;

export const DOCKERFILE_LANGUAGE = { servers: ["dockerfile"], id: "dockerfile" };

// The Compose server writes its snippets with tabs; YAML takes spaces only.
export const COMPOSE_LANGUAGE = { servers: ["compose"], id: "dockercompose", indent: "  " };

export function dockerLanguage(name) {
  if (COMPOSE.test(name)) return COMPOSE_LANGUAGE;
  if (DOCKERFILE.test(name)) return DOCKERFILE_LANGUAGE;
  return null;
}
