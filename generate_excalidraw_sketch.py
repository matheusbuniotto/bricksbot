import json
import random

random.seed(1337)

elements = []
element_id_counter = 0

def next_id(prefix="elem"):
    global element_id_counter
    element_id_counter += 1
    return f"{prefix}_{element_id_counter}_{random.randint(1000, 9999)}"

def add_rect(x, y, w, h, stroke_color="#1e1e1e", bg_color="#ffffff", stroke_width=2, stroke_style="solid", fill_style="hachure", roughness=2, roundness=3):
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

def add_text(x, y, w, h, text, font_size=20, font_family=1, text_align="center", vertical_align="middle", color="#1e1e1e"):
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
        "roughness": 1,
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

def add_draw_card(x, y, w, h, title, subtitle="", stroke_color="#1e1e1e", bg_color="#ffffff", fill_style="hachure", title_color="#1e1e1e", sub_color="#495057", title_size=20, sub_size=14):
    rect_id = add_rect(x, y, w, h, stroke_color=stroke_color, bg_color=bg_color, stroke_width=2, fill_style=fill_style, roughness=2, roundness=3)
    
    if subtitle:
        title_y = y + 14
        add_text(x + 10, title_y, w - 20, title_size + 4, title, font_size=title_size, font_family=1, text_align="center", color=title_color)
        sub_y = title_y + title_size + 8
        add_text(x + 10, sub_y, w - 20, sub_size * 1.5, subtitle, font_size=sub_size, font_family=1, text_align="center", color=sub_color)
    else:
        title_y = y + (h // 2 - title_size // 2)
        add_text(x + 10, title_y, w - 20, title_size + 4, title, font_size=title_size, font_family=1, text_align="center", color=title_color)
        
    return rect_id

def add_arrow(x1, y1, x2, y2, label="", stroke_color="#1e1e1e", stroke_width=2, stroke_style="solid"):
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
        "roughness": 2,
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
        mid_x = x1 + dx / 2 - 80
        mid_y = y1 + dy / 2 - 12
        add_text(mid_x, mid_y, 160, 24, label, font_size=15, font_family=1, text_align="center", color=stroke_color)
    return elem_id

# ----------------- CLEAN SKETCH / DRAW ARCHITECTURE -----------------

# Palette (Sketch style, soft pastel fills with hand-hatched texture)
C_INK = "#1e1e1e"
C_BLUE = "#1971c2"
C_BLUE_FILL = "#d0ebff"
C_INDIGO = "#4263eb"
C_INDIGO_FILL = "#edf2ff"
C_PURPLE = "#7048e8"
C_PURPLE_FILL = "#f3f0ff"
C_GREEN = "#2b8a3e"
C_GREEN_FILL = "#d3f9d8"
C_ORANGE = "#e8590c"
C_ORANGE_FILL = "#ffe8cc"
C_YELLOW = "#f59f00"
C_YELLOW_FILL = "#fff3bf"
C_DARK = "#343a40"
C_DARK_FILL = "#e9ecef"

# 1. HEADER (Big, punchy, minimal)
add_draw_card(100, 40, 1100, 90,
              "BRICKSBOT ARCHITECTURE",
              "Durable Multi-Agent Lakehouse Platform on Databricks",
              stroke_color=C_BLUE, bg_color=C_BLUE_FILL, fill_style="hachure",
              title_color=C_BLUE, sub_color=C_INK, title_size=28, sub_size=16)

# 2. PRESENTATION LAYER (Web Client)
add_rect(100, 170, 1100, 140, stroke_color=C_BLUE, bg_color="#f8f9fa", stroke_width=2, stroke_style="dashed", fill_style="solid", roughness=2)
add_text(120, 180, 500, 25, "USER INTERFACE (React 18 + AppKit)", font_size=17, text_align="left", color=C_BLUE)

add_draw_card(120, 215, 250, 75, "Bot Roster & Spaces", "Multi-Agent Presence", stroke_color=C_BLUE, bg_color=C_BLUE_FILL, title_size=18, sub_size=14)
add_draw_card(390, 215, 250, 75, "Durable Chat", "Streaming & Tool Chips", stroke_color=C_BLUE, bg_color=C_BLUE_FILL, title_size=18, sub_size=14)
add_draw_card(660, 215, 250, 75, "3-Way Approvals", "Always / Once / Deny", stroke_color=C_YELLOW, bg_color=C_YELLOW_FILL, title_size=18, sub_size=14)
add_draw_card(930, 215, 250, 75, "Plugins & Skills", "MCP Hub & Playbooks", stroke_color=C_GREEN, bg_color=C_GREEN_FILL, title_size=18, sub_size=14)

# Arrow from UI to Harness
add_arrow(650, 310, 650, 370, "User Turns & SSE", stroke_color=C_INK, stroke_width=3)

# 3. DURABLE AGENT HARNESS (Server)
add_rect(100, 370, 1100, 140, stroke_color=C_INDIGO, bg_color="#f8f9fa", stroke_width=2, stroke_style="dashed", fill_style="solid", roughness=2)
add_text(120, 380, 600, 25, "DURABLE AGENT HARNESS (Express + Thin Pi Loop)", font_size=17, text_align="left", color=C_INDIGO)

add_draw_card(120, 415, 250, 75, "Workspace Auth", "App SP + SSO Tokens", stroke_color=C_INDIGO, bg_color=C_INDIGO_FILL, title_size=18, sub_size=14)
add_draw_card(390, 415, 250, 75, "Primary Router", "handoff_to_bot", stroke_color=C_INDIGO, bg_color=C_INDIGO_FILL, title_size=18, sub_size=14)
add_draw_card(660, 415, 250, 75, "Idempotency", "requestId Deduplication", stroke_color=C_INDIGO, bg_color=C_INDIGO_FILL, title_size=18, sub_size=14)
add_draw_card(930, 415, 250, 75, "Sliding Compaction", "Token Budget Summary", stroke_color=C_INDIGO, bg_color=C_INDIGO_FILL, title_size=18, sub_size=14)

# 3 Downward Arrows to the 3 Core Pillars
add_arrow(280, 510, 280, 580, "Prompting", stroke_color=C_PURPLE, stroke_width=2)
add_arrow(650, 510, 650, 580, "Tool Preflight & Exec", stroke_color=C_GREEN, stroke_width=2)
add_arrow(1020, 510, 1020, 580, "Isolated Run", stroke_color=C_ORANGE, stroke_width=2)

# 4. THREE PILLARS (Models, Tools, Sandbox)

# Pillar 1: Models
add_rect(100, 580, 340, 240, stroke_color=C_PURPLE, bg_color="#fcfaff", stroke_width=2, stroke_style="solid", fill_style="solid", roughness=2)
add_text(120, 595, 300, 25, "1. MODEL INFERENCE", font_size=18, text_align="center", color=C_PURPLE)

add_draw_card(120, 635, 300, 75, "OpenAI-Compatible", "OpenRouter (Claude 3.5, GPT-4o)", stroke_color=C_PURPLE, bg_color=C_PURPLE_FILL, title_size=17, sub_size=13)
add_arrow(270, 710, 270, 735, "Fallback", stroke_color=C_PURPLE, stroke_style="dashed", stroke_width=2)
add_draw_card(120, 735, 300, 70, "Databricks Serving", "Private VPC Endpoints (DBRX, Llama)", stroke_color=C_PURPLE, bg_color=C_PURPLE_FILL, title_size=16, sub_size=12)

# Pillar 2: Tools & MCP
add_rect(480, 580, 340, 240, stroke_color=C_GREEN, bg_color="#f8fff9", stroke_width=2, stroke_style="solid", fill_style="solid", roughness=2)
add_text(500, 595, 300, 25, "2. LAKEHOUSE TOOLS & MCP", font_size=18, text_align="center", color=C_GREEN)

add_draw_card(500, 635, 300, 50, "SQL & Catalog Tools", "sql_query, lakehouse_catalog", stroke_color=C_GREEN, bg_color=C_GREEN_FILL, title_size=16, sub_size=12)
add_draw_card(500, 695, 300, 55, "Volume I/O & Memory", "volume_read/write, remember", stroke_color=C_GREEN, bg_color=C_GREEN_FILL, title_size=16, sub_size=12)
add_draw_card(500, 760, 300, 50, "MCP Plugins (teatools)", "A/B Testing, SRM & Stats", stroke_color=C_GREEN, bg_color=C_GREEN_FILL, title_size=16, sub_size=12)

# Pillar 3: Sandbox
add_rect(860, 580, 340, 240, stroke_color=C_ORANGE, bg_color="#fffaf5", stroke_width=2, stroke_style="solid", fill_style="solid", roughness=2)
add_text(880, 595, 300, 25, "3. CODE SANDBOX", font_size=18, text_align="center", color=C_ORANGE)

add_draw_card(880, 635, 300, 50, "Databricks Sandbox", "Linux Container per Chat", stroke_color=C_ORANGE, bg_color=C_ORANGE_FILL, title_size=16, sub_size=12)
add_draw_card(880, 695, 300, 55, "Artifact Sync Service", "Volumes <-> Sandbox Files", stroke_color=C_ORANGE, bg_color=C_ORANGE_FILL, title_size=16, sub_size=12)
add_draw_card(880, 760, 300, 50, "Auto Reaper", "Timeout & Egress Guardrails", stroke_color=C_ORANGE, bg_color=C_ORANGE_FILL, title_size=16, sub_size=12)

# Downward Arrows to Persistence Foundation
add_arrow(270, 820, 270, 880, stroke_color=C_INK, stroke_width=2)
add_arrow(650, 820, 650, 880, "Queries & Sync", stroke_color=C_INK, stroke_width=2)
add_arrow(1030, 820, 1030, 880, stroke_color=C_INK, stroke_width=2)

# 5. PERSISTENCE & DATABRICKS PLATFORM (The Solid Foundation)
add_rect(100, 880, 1100, 160, stroke_color=C_DARK, bg_color="#f1f3f5", stroke_width=2, stroke_style="solid", fill_style="solid", roughness=2)
add_text(120, 895, 600, 25, "PERSISTENCE & DATABRICKS LAKEHOUSE FOUNDATION", font_size=18, text_align="left", color=C_DARK)

add_draw_card(120, 930, 510, 90,
              "PostgreSQL Lakebase (bricksbot)",
              "• Durable Chats & Append-Only Messages\n• Bot Memories, Skills, Compactions & Approvals",
              stroke_color=C_DARK, bg_color=C_DARK_FILL, title_size=18, sub_size=14)

add_draw_card(670, 930, 510, 90,
              "Databricks Lakehouse & Unity Catalog",
              "• Serverless SQL Warehouses & UC Volumes\n• Enterprise Governance, Secret Scopes & Bundles",
              stroke_color=C_DARK, bg_color=C_DARK_FILL, title_size=18, sub_size=14)

# 6. BOTTOM INTERVIEW TALKING POINTS (3 Big Punchy Takeaways)
add_draw_card(100, 1060, 340, 75, "1. Zero Framework Bloat", "Pure TypeScript, native fetch, no LangChain", stroke_color=C_BLUE, bg_color=C_BLUE_FILL, title_size=18, sub_size=13)
add_draw_card(480, 1060, 340, 75, "2. Crash Resilient", "Durable Lakebase state & Pi-compatible harness", stroke_color=C_INDIGO, bg_color=C_INDIGO_FILL, title_size=18, sub_size=13)
add_draw_card(860, 1060, 340, 75, "3. Enterprise Trust", "3-way human approvals & Lakehouse governance", stroke_color=C_GREEN, bg_color=C_GREEN_FILL, title_size=18, sub_size=13)

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

# Write to both docs/ and ~/Documents/
with open("docs/architecture-interview.excalidraw", "w") as f:
    json.dump(excalidraw_data, f, indent=2)

with open("docs/architecture-interview.excalidraw.json", "w") as f:
    json.dump(excalidraw_data, f, indent=2)

with open("/Users/matheus/Documents/bricksbot-architecture-interview.excalidraw", "w") as f:
    json.dump(excalidraw_data, f, indent=2)

with open("/Users/matheus/Documents/bricksbot-architecture-interview.excalidraw.json", "w") as f:
    json.dump(excalidraw_data, f, indent=2)

print(f"Generated {len(elements)} hand-drawn sketch elements successfully.")
