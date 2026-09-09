#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("Usage: patch.py <target-root> <payload-root>")

target = Path(sys.argv[1]).resolve()
payload = Path(sys.argv[2]).resolve()


def patch_once(path: Path, anchor: str, replacement: str, marker: str) -> None:
    text = path.read_text(encoding="utf-8")
    if marker in text:
        return
    count = text.count(anchor)
    if count != 1:
        raise RuntimeError(f"Compatibility anchor mismatch in {path}: expected 1 occurrence, found {count}")
    path.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")


def copy_new(src_rel: str, dst_rel: str) -> None:
    src = payload / src_rel
    dst = target / dst_rel
    if not src.is_file():
        raise RuntimeError(f"Payload file missing: {src}")
    if dst.exists():
        raise RuntimeError(f"Refusing to overwrite new-file target: {dst}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


# 1) Add deterministic payload files.
copy_new(
    "developerHub.ts",
    "multimodal/tarko/agent-server/src/api/controllers/developerHub.ts",
)
copy_new(
    "DeveloperHub.tsx",
    "multimodal/tarko/agent-ui/src/standalone/developer/DeveloperHub.tsx",
)
copy_new(
    "DeveloperHubSettingsButton.tsx",
    "multimodal/tarko/agent-ui/src/standalone/developer/DeveloperHubSettingsButton.tsx",
)

# 2) Register source-info and source-download endpoints.
routes = target / "multimodal/tarko/agent-server/src/api/routes/system.ts"
patch_once(
    routes,
    "import * as systemController from '../controllers/system';",
    "import * as systemController from '../controllers/system';\nimport * as developerHubController from '../controllers/developerHub';",
    "developerHubController",
)
patch_once(
    routes,
    "  // Runtime settings endpoints\n",
    "  // TAR Developer Hub endpoints (Patch 0.1.0)\n"
    "  app.get('/api/v1/developer/source-info', developerHubController.getSourceInfo);\n"
    "  app.get('/api/v1/developer/source-download', developerHubController.downloadSourceCode);\n\n"
    "  // Runtime settings endpoints\n",
    "/api/v1/developer/source-download",
)

# 3) Register Developer Hub application route before the /:sessionId catch-all.
app = target / "multimodal/tarko/agent-ui/src/standalone/app/App.tsx"
patch_once(
    app,
    "import { Navbar } from '@/standalone/navbar';",
    "import { Navbar } from '@/standalone/navbar';\nimport DeveloperHub from '@/standalone/developer/DeveloperHub';",
    "standalone/developer/DeveloperHub",
)
route_block = '''      <Route
        path="/developer-hub"
        element={
          <div className="flex h-screen bg-[#F2F3F5] dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden">
            {sidebarEnabled && <Sidebar />}
            <div className="flex-1 flex flex-col overflow-hidden">
              <Navbar />
              <div className="flex-1 overflow-y-auto">
                <DeveloperHub />
              </div>
            </div>
          </div>
        }
      />
'''
patch_once(
    app,
    "      <Route\n        path=\"/:sessionId\"",
    route_block + "      <Route\n        path=\"/:sessionId\"",
    'path="/developer-hub"',
)

# 4) Surface Settings -> Developer Hub inside the existing session Navbar.
navbar = target / "multimodal/tarko/agent-ui/src/standalone/navbar/Navbar.tsx"
patch_once(
    navbar,
    "import { ThemeToggle } from '@/standalone/components';",
    "import { ThemeToggle } from '@/standalone/components';\nimport { DeveloperHubSettingsButton } from '@/standalone/developer/DeveloperHubSettingsButton';",
    "standalone/developer/DeveloperHubSettingsButton",
)
patch_once(
    navbar,
    "            {/* About button */}",
    "            {/* Settings -> Developer Hub (TAR Patch 0.1.0) */}\n"
    "            <DeveloperHubSettingsButton variant=\"navbar\" />\n\n"
    "            {/* About button */}",
    '<DeveloperHubSettingsButton variant="navbar" />',
)

# 5) Surface the same Settings entry on the home screen.
welcome = target / "multimodal/tarko/agent-ui/src/standalone/home/WelcomePage.tsx"
patch_once(
    welcome,
    "import { ThemeToggle } from '@/standalone/components';",
    "import { ThemeToggle } from '@/standalone/components';\nimport { DeveloperHubSettingsButton } from '@/standalone/developer/DeveloperHubSettingsButton';",
    "standalone/developer/DeveloperHubSettingsButton",
)
patch_once(
    welcome,
    "      {/* Theme Toggle - Fixed Position */}",
    "      {/* Settings -> Developer Hub (TAR Patch 0.1.0) */}\n"
    "      <div className=\"fixed top-6 right-16 z-20\">\n"
    "        <DeveloperHubSettingsButton variant=\"floating\" />\n"
    "      </div>\n\n"
    "      {/* Theme Toggle - Fixed Position */}",
    '<DeveloperHubSettingsButton variant="floating" />',
)

print("PATCH_SCRIPT_STATUS=PASS")
