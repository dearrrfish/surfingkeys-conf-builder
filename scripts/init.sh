#!/usr/bin/env bash
# ==============================================================================
# SurfingKeys Config Builder (skcb) Interactive Project Initializer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dearrrfish/surfingkeys-conf-builder/main/scripts/init.sh | bash
#   ./scripts/init.sh [--dir <path>] [--type proj|lib] [--ui|--no-ui] [--libs <csv>] [--skills|--no-skills] [--pm pnpm|npm|bun] [--yes] [--dry-run]
# ==============================================================================
set -euo pipefail

REPO_SLUG="${SKCB_REPO:-dearrrfish/surfingkeys-conf-builder}"
TARGET_DIR="my-surfingkeys-config"
PROJECT_TYPE="proj"
INCLUDE_UI=true
LIBS="b0o,ent,tech,prod"
INCLUDE_SKILLS=true
INCLUDE_GIST_ACTION=true
INCLUDE_PAGES_ACTION=true
PACKAGE_MANAGER=""
AUTO_YES=false
DRY_RUN=false

TMP_DIR=""
cleanup() {
  local exit_code=$?
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
  if [[ $exit_code -ne 0 ]]; then
    echo -e "\n\033[1;31m[ERROR]\033[0m skcb initialization failed. Aborting without partial changes." >&2
  fi
}
trap cleanup EXIT ERR

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    --type)
      PROJECT_TYPE="$2"
      shift 2
      ;;
    --ui)
      INCLUDE_UI=true
      shift
      ;;
    --no-ui)
      INCLUDE_UI=false
      shift
      ;;
    --libs)
      LIBS="$2"
      shift 2
      ;;
    --skills)
      INCLUDE_SKILLS=true
      shift
      ;;
    --no-skills)
      INCLUDE_SKILLS=false
      shift
      ;;
    --gist-action)
      INCLUDE_GIST_ACTION=true
      shift
      ;;
    --no-gist-action)
      INCLUDE_GIST_ACTION=false
      shift
      ;;
    --pages-action)
      INCLUDE_PAGES_ACTION=true
      shift
      ;;
    --no-pages-action)
      INCLUDE_PAGES_ACTION=false
      shift
      ;;
    --pm)
      PACKAGE_MANAGER="$2"
      shift 2
      ;;
    -y|--yes)
      AUTO_YES=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "SurfingKeys Config Builder (skcb) Project Initializer"
      echo ""
      echo "Options:"
      echo "  --dir <path>       Target directory (default: my-surfingkeys-config)"
      echo "  --type <proj|lib>  Project type: 'proj' (config project) or 'lib' (module library)"
      echo "  --ui / --no-ui     Include @skcb/ui server & visual frontend"
      echo "  --libs <csv>       Comma-separated libraries: b0o,ent,tech,prod"
      echo "  --skills / --no-skills  Install AI agent skills"
      echo "  --gist-action / --no-gist-action  Include GitHub Gist publishing action (default: true)"
      echo "  --pages-action / --no-pages-action  Include GitHub Pages static SPA workflow (default: true)"
      echo "  --pm <pnpm|npm|bun>     Package manager to use"
      echo "  -y, --yes          Non-interactive mode (use defaults)"
      echo "  --dry-run          Simulate creation without writing files"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Detect interactive terminal (/dev/tty for curl | bash support)
TTY="/dev/tty"
is_interactive() {
  [[ "$AUTO_YES" == "false" && -t 0 ]] || [[ "$AUTO_YES" == "false" && -e "$TTY" && -r "$TTY" ]]
}

prompt() {
  local var_name="$1"
  local prompt_text="$2"
  local default_val="$3"

  if is_interactive; then
    echo -n -e "\033[1;34m?\033[0m $prompt_text \033[2m[$default_val]\033[0m: " > "$TTY"
    read -r input < "$TTY"
    if [[ -n "$input" ]]; then
      eval "$var_name=\"\$input\""
    else
      eval "$var_name=\"\$default_val\""
    fi
  else
    eval "$var_name=\"\$default_val\""
  fi
}

echo -e "\033[1;36m========================================================\033[0m"
echo -e "\033[1;36m  ⚡ SurfingKeys Config Builder (skcb) Initializer      \033[0m"
echo -e "\033[1;36m========================================================\033[0m"

# Interactive questions
if is_interactive; then
  prompt TARGET_DIR "Target project directory" "$TARGET_DIR"
  prompt PROJECT_TYPE "Project type (proj: configuration workspace, lib: module package)" "$PROJECT_TYPE"
  if [[ "$PROJECT_TYPE" == "proj" ]]; then
    prompt LIBS "Functional libraries to include (comma-separated: b0o,ent,tech,prod)" "$LIBS"
    prompt INCLUDE_UI "Include @skcb/ui visual distribution server? (true/false)" "$INCLUDE_UI"
    prompt INCLUDE_SKILLS "Install AI pairing skills into skills/? (true/false)" "$INCLUDE_SKILLS"
    prompt INCLUDE_GIST_ACTION "Include GitHub Actions Gist publisher? (true/false)" "$INCLUDE_GIST_ACTION"
    prompt INCLUDE_PAGES_ACTION "Include GitHub Actions Pages SPA workflow? (true/false)" "$INCLUDE_PAGES_ACTION"
  fi
fi

# Detect package manager if not specified
if [[ -z "$PACKAGE_MANAGER" ]]; then
  if command -v pnpm &>/dev/null; then
    PACKAGE_MANAGER="pnpm"
  elif command -v bun &>/dev/null; then
    PACKAGE_MANAGER="bun"
  elif command -v npm &>/dev/null; then
    PACKAGE_MANAGER="npm"
  else
    PACKAGE_MANAGER="npm"
  fi
fi

echo -e "\n\033[1;32mConfiguration Summary:\033[0m"
echo "  Target:          $TARGET_DIR"
echo "  Type:            $PROJECT_TYPE"
echo "  Package Manager: $PACKAGE_MANAGER"
if [[ "$PROJECT_TYPE" == "proj" ]]; then
  echo "  Libraries:       $LIBS"
  echo "  Include UI:      $INCLUDE_UI"
  echo "  Install Skills:  $INCLUDE_SKILLS"
  echo "  Gist Publishing: $INCLUDE_GIST_ACTION"
  echo "  Pages Workflow:  $INCLUDE_PAGES_ACTION"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "\n\033[1;33m[DRY RUN]\033[0m Initialization plan verified. Exiting without changes."
  exit 0
fi

# Determine source templates directory if running from a local clone
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" &>/dev/null && pwd)"
  REPO_ROOT="$(dirname "$SCRIPT_DIR")"
  TEMPLATE_PROJ="$REPO_ROOT/templates/skcb-proj-repo"
  TEMPLATE_LIB="$REPO_ROOT/templates/skcb-lib-repo"
  LOCAL_SKILLS="$REPO_ROOT/skills"
else
  SCRIPT_DIR=""
  REPO_ROOT=""
  TEMPLATE_PROJ=""
  TEMPLATE_LIB=""
  LOCAL_SKILLS=""
fi

if [[ -d "$TARGET_DIR" && "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]]; then
  echo -e "\033[1;31m[ERROR]\033[0m Directory '$TARGET_DIR' already exists and is not empty." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"

if [[ "$PROJECT_TYPE" == "lib" ]]; then
  echo -e "\n🚀 Generating module library template..."
  if [[ -n "$TEMPLATE_LIB" && -d "$TEMPLATE_LIB" ]]; then
    cp -r "$TEMPLATE_LIB/." "$TMP_DIR/"
  else
    npx -y degit "$REPO_SLUG/templates/skcb-lib-repo" "$TMP_DIR"
  fi
else
  echo -e "\n🚀 Generating configuration project workspace..."
  if [[ -n "$TEMPLATE_PROJ" && -d "$TEMPLATE_PROJ" ]]; then
    cp -r "$TEMPLATE_PROJ/." "$TMP_DIR/"
  else
    npx -y degit "$REPO_SLUG/templates/skcb-proj-repo" "$TMP_DIR"
  fi

  # Tailor workspace libraries in surfingkeys.workspace.json
  IFS=',' read -ra LIB_ARRAY <<< "$LIBS"
  LIB_JSON_ITEMS=""
  for lib in "${LIB_ARRAY[@]}"; do
    lib="$(echo "$lib" | xargs)"
    if [[ -n "$lib" ]]; then
      if [[ -n "$LIB_JSON_ITEMS" ]]; then
        LIB_JSON_ITEMS="$LIB_JSON_ITEMS,\n    \"@skcb/lib-$lib\""
      else
        LIB_JSON_ITEMS="\"@skcb/lib-$lib\""
      fi
    fi
  done
  LIB_JSON_ITEMS="$LIB_JSON_ITEMS,\n    \"./extensions/custom\""

  cat > "$TMP_DIR/surfingkeys.workspace.json" <<EOF
{
  "schemaVersion": 2,
  "libraries": [
    $(echo -e "$LIB_JSON_ITEMS")
  ],
  "profilesDir": "profiles",
  "outDir": "dist"
}
EOF

  # Copy skills if requested
  if [[ "$INCLUDE_SKILLS" == "true" ]]; then
    mkdir -p "$TMP_DIR/skills"
    if [[ -n "$LOCAL_SKILLS" && -d "$LOCAL_SKILLS" ]]; then
      cp -r "$LOCAL_SKILLS/." "$TMP_DIR/skills/"
    else
      npx -y degit "$REPO_SLUG/skills" "$TMP_DIR/skills" || true
    fi
  fi

  # Remove Gist publishing workflow if requested not to include
  if [[ "$INCLUDE_GIST_ACTION" == "false" ]]; then
    rm -f "$TMP_DIR/.github/workflows/publish-gist.yml"
    rm -f "$TMP_DIR/scripts/publish-gist.mjs"
  fi

  # Remove Pages workflow if requested not to include
  if [[ "$INCLUDE_PAGES_ACTION" == "false" ]]; then
    rm -f "$TMP_DIR/.github/workflows/pages.yml"
    rm -f "$TMP_DIR/scripts/validate-profiles.mjs"
  fi

  rmdir "$TMP_DIR/.github/workflows" 2>/dev/null || true
  rmdir "$TMP_DIR/.github" 2>/dev/null || true
  rmdir "$TMP_DIR/scripts" 2>/dev/null || true
fi

# Move finished tree to TARGET_DIR
mkdir -p "$TARGET_DIR"
cp -r "$TMP_DIR/." "$TARGET_DIR/"
rm -rf "$TMP_DIR"
TMP_DIR=""

echo -e "\n\033[1;32m🎉 Successfully initialized skcb project at:\033[0m $TARGET_DIR"
echo -e "\nNext steps:"
echo "  cd $TARGET_DIR"
echo "  $PACKAGE_MANAGER install"
if [[ "$PROJECT_TYPE" == "proj" ]]; then
  echo "  $PACKAGE_MANAGER run build"
  echo "  $PACKAGE_MANAGER run ui"
else
  echo "  $PACKAGE_MANAGER run build"
fi
echo ""
