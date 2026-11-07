import json
import random

random.seed(42)

elements = []
element_id_counter = 0

def next_id(prefix="elem"):
    global element_id_counter
    element_id_counter += 1
    return f"{prefix}_{element_id_counter}_{random.randint(1000, 9999)}"

def add_rect(x, y, w, h, stroke_color="#1e1e1e", bg_color="#ffffff", stroke_width=2, stroke_style="solid", fill_style="solid", roughness=1, roundness=3):
    elem_id = next_id("rect")
    elem = {
        "id": elem_id,
        "type": "rectangle",
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "angle": 0,
        "strokeColor": stroke_color,
        "backgroundColor": bg_color,
        "fillStyle": fill_style,
        "strokeWidth": stroke_width,
        "strokeStyle": stroke_style,
        "roughness": roughness,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": {"type": roundness} if roundness else None,
        "seed": random.randint(10000, 99999),
        "version": 1,
        "versionNonce": random.randint(1, 10000),
        "isDeleted": False,
        "boundElements": None,
        "updated": 1,
        "link": None,
        "locked": False
    }
    elements.append(elem)
    return elem_id

def add_text(x, y, w, h, text, font_size=16, font_family=1, text_align="center", vertical_align="middle", color="#1e1e1e"):
    elem_id = next_id("text")
    lines = text.split("\n")
    line_height = font_size * 1.3
    computed_h = max(h, len(lines) * line_height)
    
    elem = {
        "id": elem_id,
        "type": "text",
        "x": x,
        "y": y,
        "width": w,
        "height": computed_h,
        "angle": 0,
        "strokeColor": color,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 0,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "seed": random.randint(10000, 99999),
        "version": 1,
        "versionNonce": random.randint(1, 10000),
        "isDeleted": False,
        "boundElements": None,
        "updated": 1,
        "link": None,
        "locked": False,
        "text": text,
        "fontSize": font_size,
        "fontFamily": font_family,
        "textAlign": text_align,
        "verticalAlign": vertical_align,
        "baseline": font_size,
        "containerId": None,
        "originalText": text
    }
    elements.append(elem)
    return elem_id

def add_card(x, y, w, h, title, subtitle="", stroke_color="#1e1e1e", bg_color="#ffffff", title_color="#1e1e1e", sub_color="#495057", title_size=16, sub_size=13, title_align="center", sub_align="center"):
    rect_id = add_rect(x, y, w, h, stroke_color=stroke_color, bg_color=bg_color, stroke_width=2, roundness=3)
    
    title_y = y + (10 if subtitle else (h // 2 - title_size // 2))
    add_text(x + 8, title_y, w - 16, title_size + 4, title, font_size=title_size, font_family=1, text_align=title_align, color=title_color)
    
    if subtitle:
        sub_y = title_y + title_size + 8
        add_text(x + 10, sub_y, w - 20, h - (sub_y - y) - 6, subtitle, font_size=sub_size, font_family=1, text_align=sub_align, color=sub_color)
    return rect_id

def add_arrow(x1, y1, x2, y2, label="", stroke_color="#495057", stroke_style="solid", stroke_width=2):
    elem_id = next_id("arrow")
    dx = x2 - x1
    dy = y2 - y1
    elem = {
        "id": elem_id,
        "type": "arrow",
        "x": x1,
        "y": y1,
        "width": abs(dx),
        "height": abs(dy),
        "angle": 0,
        "strokeColor": stroke_color,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": stroke_width,
        "strokeStyle": stroke_style,
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": {"type": 2},
        "seed": random.randint(10000, 99999),
        "version": 1,
        "versionNonce": random.randint(1, 10000),
        "isDeleted": False,
        "boundElements": None,
        "updated": 1,
        "link": None,
        "locked": False,
        "points": [[0, 0], [dx, dy]],
        "lastCommittedPoint": None,
        "startBinding": None,
        "endBinding": None,
        "startArrowhead": None,
        "endArrowhead": "arrow"
    }
    elements.append(elem)
    
    if label:
        mid_x = x1 + dx / 2 - 60
        mid_y = y1 + dy / 2 - 10
        add_text(mid_x, mid_y, 120, 20, label, font_size=12, text_align="center", color=stroke_color)
    return elem_id

# ----------------- BUILD ARCHITECTURE DIAGRAM -----------------

# Palette
C_HEADER_BG = "#e7f5ff"
C_HEADER_BORDER = "#1971c2"

C_UI_BG = "#f8f9fa"
C_UI_BORDER = "#adb5bd"
C_CARD_UI_BG = "#e3fafc"
C_CARD_UI_BORDER = "#1098ad"

C_GATEWAY_BG = "#f8f9fa"
C_GATEWAY_BORDER = "#adb5bd"
C_CARD_GW_BG = "#edf2ff"
C_CARD_GW_BORDER = "#4263eb"

C_MODELS_BG = "#f3f0ff"
C_MODELS_BORDER = "#7048e8"
C_CARD_MODEL_BG = "#ffffff"
C_CARD_MODEL_BORDER = "#845ef7"

C_TOOLS_BG = "#ebfbee"
C_TOOLS_BORDER = "#2b8a3e"
C_CARD_TOOL_BG = "#ffffff"
C_CARD_TOOL_BORDER = "#37b24d"

C_SANDBOX_BG = "#fff4e6"
C_SANDBOX_BORDER = "#e8590c"
C_CARD_SANDBOX_BG = "#ffffff"
C_CARD_SANDBOX_BORDER = "#f76707"

C_DATA_BG = "#f1f3f5"
C_DATA_BORDER = "#495057"
C_CARD_DATA_BG = "#ffffff"
C_CARD_DATA_BORDER = "#343a40"

C_HIGHLIGHT_BG = "#fff9db"
C_HIGHLIGHT_BORDER = "#f59f00"

# 0. HEADER BANNER
add_card(50, 30, 1340, 85,
         "BRICKSBOT — COMPLETE SYSTEM ARCHITECTURE",
         "Enterprise Multi-Agent Lakehouse Platform on Databricks • Pi-Durable Loop • 3-Way Approvals • Execution Sandboxes",
         stroke_color=C_HEADER_BORDER, bg_color=C_HEADER_BG, title_color="#0c8599", sub_color="#1864ab", title_size=22, sub_size=14)

# 1. PRESENTATION LAYER
add_rect(50, 140, 1340, 160, stroke_color=C_UI_BORDER, bg_color=C_UI_BG, stroke_style="dashed", roundness=3)
add_text(70, 150, 400, 20, "1. PRESENTATION LAYER (React 18 + Vite + AppKit UI)", font_size=15, text_align="left", color="#495057")

add_card(75, 180, 235, 105,
         "Bot Roster & Spaces",
         "• Personal & Team Spaces\n• Presence Badges\n  (online/thinking/waiting)\n• Primary router & roster",
         stroke_color=C_CARD_UI_BORDER, bg_color=C_CARD_UI_BG, title_color="#0b7285", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

add_card(335, 180, 235, 105,
         "Durable Transcript",
         "• Real-time SSE streaming\n• Tool execution chips\n• Handoff peek & summary\n• Pin Artifact / Chart views",
         stroke_color=C_CARD_UI_BORDER, bg_color=C_CARD_UI_BG, title_color="#0b7285", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

add_card(595, 180, 235, 105,
         "Approvals & Choices",
         "• 3-Way Human-in-the-Loop\n  (Always allow / Once / Deny)\n• Interactive Ask-Choice cards\n• Routine Trust indicators",
         stroke_color=C_CARD_UI_BORDER, bg_color=C_CARD_UI_BG, title_color="#0b7285", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

add_card(855, 180, 235, 105,
         "Connectors & Plugins",
         "• Lakehouse tools status\n• Per-bot Skill Packs & Import\n• MCP Discovery Hub\n• Custom skill authoring",
         stroke_color=C_CARD_UI_BORDER, bg_color=C_CARD_UI_BG, title_color="#0b7285", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

add_card(1115, 180, 255, 105,
         "Computer & Sandboxes",
         "• Interactive web terminal\n• Volume artifact explorer\n• Process output telemetry\n• Sandbox lifecycle controls",
         stroke_color=C_CARD_UI_BORDER, bg_color=C_CARD_UI_BG, title_color="#0b7285", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

# Arrow from UI to Gateway
add_arrow(720, 300, 720, 350, "User Turns, Approvals, Choices, SSE", stroke_color="#1971c2", stroke_width=2)

# 2. ORCHESTRATION & HARNESS
add_rect(50, 350, 1340, 175, stroke_color=C_GATEWAY_BORDER, bg_color=C_GATEWAY_BG, stroke_style="dashed", roundness=3)
add_text(70, 360, 500, 20, "2. API GATEWAY & DURABLE AGENT HARNESS (Express 4 + AppKit + Thin Pi Loop)", font_size=15, text_align="left", color="#495057")

add_card(75, 390, 295, 120,
         "Databricks Auth & Context",
         "• App Service Principal\n• User OBO Workspace tokens\n• RBAC Space membership (viewer/admin)\n• Workspace Secret Scopes",
         stroke_color=C_CARD_GW_BORDER, bg_color=C_CARD_GW_BG, title_color="#364fc7", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

add_card(395, 390, 295, 120,
         "Idempotency & Resilience",
         "• Client-side requestId deduplication\n• Crash-resilient turn resumption\n• Atomic message state transitions\n• No duplicate tool executions",
         stroke_color=C_CARD_GW_BORDER, bg_color=C_CARD_GW_BG, title_color="#364fc7", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

add_card(715, 390, 295, 120,
         "Primary Router & Handoff",
         "• Primary triage & handoff_to_bot\n• Teammate one-turn execution\n• Bidirectional notice chip sync\n• Dynamic tool capability catalog",
         stroke_color=C_CARD_GW_BORDER, bg_color=C_CARD_GW_BG, title_color="#364fc7", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

add_card(1035, 390, 335, 120,
         "Durable Compaction Engine",
         "• Token budgeting per model window\n• Sliding window keepFromIndex\n• Tool-call atomicity preservation\n• Never deletes raw transcript history",
         stroke_color=C_CARD_GW_BORDER, bg_color=C_CARD_GW_BG, title_color="#364fc7", sub_color="#212529", title_size=15, sub_size=12, sub_align="left")

# Downward arrows from Gateway to 3 columns
add_arrow(220, 525, 220, 570, "LLM Prompting", stroke_color="#7048e8", stroke_width=2)
add_arrow(720, 525, 720, 570, "Tool Preflight & Exec", stroke_color="#2b8a3e", stroke_width=2)
add_arrow(1200, 525, 1200, 570, "Sandbox Exec", stroke_color="#e8590c", stroke_width=2)

# 3. THREE MIDDLE COLUMNS

# Column 3.1: Model Inference
add_rect(50, 570, 360, 340, stroke_color=C_MODELS_BORDER, bg_color=C_MODELS_BG, stroke_style="solid", roundness=3)
add_text(65, 580, 330, 20, "3. MODEL CLIENT LAYER", font_size=15, text_align="left", color="#5f3dc4")

add_card(65, 615, 330, 95,
         "Primary: OpenAI-Compatible",
         "• OpenRouter API (Claude 3.5, GPT-4o)\n• Streaming completions with tool_calls\n• Strict JSON schema validation\n• Zero 'fast' low-reasoning models",
         stroke_color=C_CARD_MODEL_BORDER, bg_color=C_CARD_MODEL_BG, title_color="#5f3dc4", sub_color="#212529", title_size=14, sub_size=12, sub_align="left")

add_arrow(230, 710, 230, 745, "Failover / Fallback", stroke_color="#845ef7", stroke_style="dashed", stroke_width=2)

add_card(65, 750, 330, 95,
         "Databricks Model Serving",
         "• Workspace Private Endpoints\n• DBRX, Llama-3-70B, Custom Models\n• No egress traffic (VPC Internal)\n• Local Stub fallback for testing",
         stroke_color=C_CARD_MODEL_BORDER, bg_color=C_CARD_MODEL_BG, title_color="#5f3dc4", sub_color="#212529", title_size=14, sub_size=12, sub_align="left")

add_card(65, 855, 330, 45,
         "Strict OpenAI Tool Call Pairing",
         "Assistant tool_calls MUST precede matching tool rows",
         stroke_color="#b197fc", bg_color="#ffffff", title_color="#495057", sub_color="#868e96", title_size=12, sub_size=11)

# Column 3.2: Agent Tools & MCP
add_rect(430, 570, 580, 340, stroke_color=C_TOOLS_BORDER, bg_color=C_TOOLS_BG, stroke_style="solid", roundness=3)
add_text(445, 580, 550, 20, "4. TOOLS, MEMORY & MCP EXTENSION LAYER", font_size=15, text_align="left", color="#2b8a3e")

add_card(445, 615, 550, 85,
         "Lakehouse Native Tools (3-Way Approved)",
         "• sql_query: Serverless SQL Warehouse execution with row/byte guardrails\n• lakehouse_catalog: Schema discovery across Unity Catalog\n• volume_read / volume_write: File I/O directly in Unity Catalog Volumes",
         stroke_color=C_CARD_TOOL_BORDER, bg_color=C_CARD_TOOL_BG, title_color="#2b8a3e", sub_color="#212529", title_size=14, sub_size=12, sub_align="left")

add_card(445, 710, 550, 85,
         "Pi-Compatible Meta-Tools & Memory",
         "• activate_skill & read_skill_resource: Progressive skill body retrieval\n• remember & forget: Bot episodic facts (or background OptMem rollup)\n• save_skill & ask_choice: Self-improving skills & human clarifications",
         stroke_color=C_CARD_TOOL_BORDER, bg_color=C_CARD_TOOL_BG, title_color="#2b8a3e", sub_color="#212529", title_size=14, sub_size=12, sub_align="left")

add_card(445, 805, 550, 95,
         "Model Context Protocol (MCP) & Plugins Hub",
         "• system.ai.genie: Opt-in Genie conversational analytics (Cost-governed)\n• system.ai.dbsql: Databricks SQL MCP metadata provider\n• plugin.teatools: Native TS statistical engine (A/B testing, SRM, power, analysis)\n• Skill Packs: Hypothesis Testing Playbook & PREREGISTRATION templates",
         stroke_color=C_CARD_TOOL_BORDER, bg_color=C_CARD_TOOL_BG, title_color="#2b8a3e", sub_color="#212529", title_size=14, sub_size=12, sub_align="left")

# Column 3.3: Execution Sandbox
add_rect(1030, 570, 360, 340, stroke_color=C_SANDBOX_BORDER, bg_color=C_SANDBOX_BG, stroke_style="solid", roundness=3)
add_text(1045, 580, 330, 20, "5. PHASE 5 CODE SANDBOX", font_size=15, text_align="left", color="#d9480f")

add_card(1045, 615, 330, 90,
         "Execution Backends",
         "• Databricks Sandbox (default preview)\n• python_exec (local subprocess fallback)\n• E2B cloud micro-VM support\n• Isolated Linux environment per chat",
         stroke_color=C_CARD_SANDBOX_BORDER, bg_color=C_CARD_SANDBOX_BG, title_color="#d9480f", sub_color="#212529", title_size=14, sub_size=12, sub_align="left")

add_card(1045, 715, 330, 90,
         "Artifact Sync Service",
         "• Bidirectional sync between sandbox fs\n  and Databricks Unity Catalog Volumes\n• Auto-upload user datasets to sandbox\n• Auto-persist generated plots/models",
         stroke_color=C_CARD_SANDBOX_BORDER, bg_color=C_CARD_SANDBOX_BG, title_color="#d9480f", sub_color="#212529", title_size=14, sub_size=12, sub_align="left")

add_card(1045, 815, 330, 85,
         "Reaper & Security Guardrails",
         "• Automated idle container timeout reaper\n• Ask-first approvals for sandbox_delete\n• Network egress firewall restrictions\n• Non-root container privileges",
         stroke_color=C_CARD_SANDBOX_BORDER, bg_color=C_CARD_SANDBOX_BG, title_color="#d9480f", sub_color="#212529", title_size=14, sub_size=12, sub_align="left")

# Downward arrows to Lakehouse & Storage
add_arrow(230, 910, 230, 960, stroke_color="#495057", stroke_width=2)
add_arrow(720, 910, 720, 960, "Lakehouse Queries & Writes", stroke_color="#495057", stroke_width=2)
add_arrow(1200, 910, 1200, 960, "Volume Sync & Sessions", stroke_color="#495057", stroke_width=2)

# 4. DATA & LAKEHOUSE STORAGE LAYER
add_rect(50, 960, 1340, 250, stroke_color=C_DATA_BORDER, bg_color=C_DATA_BG, stroke_style="solid", roundness=3)
add_text(70, 970, 600, 20, "6. PERSISTENCE & DATABRICKS LAKEHOUSE INFRASTRUCTURE", font_size=16, text_align="left", color="#212529")

add_card(75, 1000, 620, 195,
         "PostgreSQL Lakebase (Schema: bricksbot)",
         "• spaces & space_members: Multi-user tenant isolation & spaces\n• bots & chats: Bot roster, presence state, and 1:1 chat bindings\n• messages: Append-only conversation transcript with tool_call pairs\n• bot_memories & bot_skills: Long-term bot facts & self-improved skills\n• compactions: Sliding window conversation summaries\n• approvals & auto_approvals & approval_events: Comprehensive audit trail\n• routines: Cron & webhook scheduled autonomous agent runs\n• sandbox_sessions: Active Linux execution environments and state",
         stroke_color=C_CARD_DATA_BORDER, bg_color=C_CARD_DATA_BG, title_color="#1e1e1e", sub_color="#343a40", title_size=15, sub_size=12, sub_align="left")

add_card(715, 1000, 655, 195,
         "Databricks Lakehouse & Unity Catalog Platform",
         "• Databricks SQL Serverless Warehouses: High-speed analytics query engine\n• Unity Catalog Volumes: Filesystem storage for datasets, CSVs, ML artifacts\n• Unity Catalog Governance: Strict ACLs, column masking, audit lineage\n• Databricks App Runtime: Containerized deployment on Databricks AppKit\n• Databricks Secrets: Scope 'bricksbot' storing openrouter-api-key\n• Databricks Asset Bundles (DAB): Automated dev & prod workspace deployment",
         stroke_color=C_CARD_DATA_BORDER, bg_color=C_CARD_DATA_BG, title_color="#1e1e1e", sub_color="#343a40", title_size=15, sub_size=12, sub_align="left")

# 5. BOTTOM HIGHLIGHT BANNER FOR INTERVIEWS
add_card(50, 1230, 1340, 95,
         "KEY ARCHITECTURAL HIGHLIGHTS FOR TECHNICAL INTERVIEWS",
         "1. Zero Framework Bloat: Built in pure TypeScript/AppKit without LangChain or LlamaIndex overhead\n2. Enterprise Trust & Safety: 3-way approvals (always/once/deny) and complete approval_events audit trail\n3. Pi-Compatible Durable Harness: Never loses raw history; token-budgeted compaction; crash-resilient requestId dedupe\n4. Lakehouse Native: Direct Unity Catalog governance, Serverless SQL execution, Volume I/O, and Genie analytics",
         stroke_color=C_HIGHLIGHT_BORDER, bg_color=C_HIGHLIGHT_BG, title_color="#d9480f", sub_color="#495057", title_size=15, sub_size=12, sub_align="left")

excalidraw_data = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": elements,
    "appState": {
        "gridSize": None,
        "viewBackgroundColor": "#ffffff"
    },
    "files": {}
}

with open("docs/architecture-interview.excalidraw", "w") as f:
    json.dump(excalidraw_data, f, indent=2)

with open("docs/architecture-interview.excalidraw.json", "w") as f:
    json.dump(excalidraw_data, f, indent=2)

print(f"Generated {len(elements)} Excalidraw elements successfully.")
