#!/usr/bin/env python3
"""Catches QML that a live shell would reject, which none of the other tests can
run: an attached Layout property Qt 6 does not have, and a Canvas placed inside
a positioner that would lay it out like a cell."""

from pathlib import Path
import re
import unittest


PLUGIN = Path(__file__).parents[1]
QML = sorted(PLUGIN.glob("*.qml"))

# Every attached property of QtQuick.Layouts' `Layout` in Qt 6.
LAYOUT_ATTACHED = {
    "alignment", "bottomMargin", "column", "columnSpan", "fillHeight", "fillWidth",
    "horizontalStretchFactor", "leftMargin", "margins", "maximumHeight", "maximumWidth",
    "minimumHeight", "minimumWidth", "preferredHeight", "preferredWidth", "rightMargin",
    "row", "rowSpan", "topMargin", "verticalStretchFactor",
}
# Types that arrange their children, so a Canvas inside one is laid out as a cell.
POSITIONERS = {"RowLayout", "ColumnLayout", "GridLayout", "StackLayout", "Row", "Column", "Grid", "Flow"}


def code(source):
    """The source without comments and string literals (braces in them are not structure)."""
    # One pass so a quote inside a comment, or `//` inside a string, is not misread.
    def blank(match):
        text = match.group(0)
        return "" if text.startswith("/") else text[0] + text[0]
    return re.sub(r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|//[^\n]*|/\*.*?\*/', blank, source, flags=re.S)


def parent_types(source, child):
    """The type of the nearest enclosing object for every `child {` in the source."""
    text = code(source)
    stack = []
    found = []
    for match in re.finditer(r"([A-Za-z_][\w.]*)?\s*\{|\}", text):
        if match.group(0) == "}":
            if stack:
                stack.pop()
            continue
        name = match.group(1)
        label = name if name and name[0].isupper() and re.search(r"(^|[\s;{}])" + re.escape(name) + r"\s*\{$", text[:match.end()]) else None
        if label == child:
            enclosing = next((t for t in reversed(stack) if t), None)
            found.append(enclosing)
        stack.append(label)
    return found


def elements(source):
    """The object tree: [{type, start, end, children, text}] for every `Type {` in the source."""
    text = code(source)
    root = {"type": None, "start": 0, "end": len(text), "children": [], "text": text}
    stack = [root]
    for match in re.finditer(r"([A-Za-z_][\w.]*)?\s*\{|\}", text):
        if match.group(0) == "}":
            if len(stack) > 1:
                node = stack.pop()
                node["end"] = match.end()
                node["text"] = text[node["start"]:node["end"]]
            continue
        name = match.group(1)
        is_object = bool(name) and name[0].isupper() and "." not in name and \
            re.search(r"(^|[\s;{}])" + re.escape(name) + r"\s*\{$", text[:match.end()]) is not None
        node = {"type": name if is_object else None, "start": match.start(), "end": len(text), "children": [], "text": ""}
        stack[-1]["children"].append(node)
        stack.append(node)
    return root


def own_text(node):
    """A node's text without the text of its nested objects."""
    text = node["text"]
    for child in node["children"]:
        text = text.replace(child["text"], "")
    return text


def walk(node, parent_type=None):
    """(object type, direct text, enclosing object type) for every object, nested blocks included."""
    for child in node["children"]:
        if child["type"]:
            yield child["type"], own_text_objects(child), parent_type
            yield from walk(child, child["type"])
        else:
            yield from walk(child, parent_type)


def own_text_objects(node):
    """Text of the object itself: its lines, without nested objects (but with function bodies)."""
    text = node["text"]
    for child in node["children"]:
        if child["type"]:
            text = text.replace(child["text"], "")
    return text


class QmlPropertyTests(unittest.TestCase):
    def test_only_attached_layout_properties_qt_6_has(self):
        for path in QML:
            for name in re.findall(r"\bLayout\.(\w+)", code(path.read_text(encoding="utf-8"))):
                self.assertIn(name, LAYOUT_ATTACHED, "%s uses Layout.%s, which Qt 6 does not have" % (path.name, name))

    def test_ignore_layout_is_not_used_anywhere(self):
        for path in QML:
            self.assertNotIn("ignoreLayout", path.read_text(encoding="utf-8"), path.name)

    def test_the_checker_itself_sees_a_canvas_in_a_layout(self):
        sample = "Item {\n  RowLayout {\n    Canvas { id: c }\n  }\n  Canvas { id: d }\n}\n"
        self.assertEqual(parent_types(sample, "Canvas"), ["RowLayout", "Item"])
        # Braces in strings and comments do not confuse it.
        tricky = 'Item {\n  // RowLayout {\n  Text { text: "{ RowLayout {" }\n  Canvas { }\n}\n'
        self.assertEqual(parent_types(tricky, "Canvas"), ["Item"])

    def test_no_canvas_sits_inside_a_layout_or_positioner(self):
        for path in QML:
            for parent in parent_types(path.read_text(encoding="utf-8"), "Canvas"):
                self.assertNotIn(parent, POSITIONERS, "%s has a Canvas inside a %s" % (path.name, parent))

    def test_a_row_or_column_child_uses_no_anchor_the_positioner_owns(self):
        # Qt warns, and the positioner stops working, if a child of a Row anchors
        # horizontally or a child of a Column anchors vertically (or fills/centres).
        row = re.compile(r"anchors\.(left|right|horizontalCenter|fill|centerIn)\b|\banchors\s*\{")
        column = re.compile(r"anchors\.(top|bottom|verticalCenter|fill|centerIn)\b|\banchors\s*\{")
        for path in QML:
            for kind, text, parent in walk(elements(path.read_text(encoding="utf-8"))):
                if parent == "Row" and row.search(own_text_objects_head(text)):
                    self.fail("%s: a %s inside a Row uses a horizontal anchor" % (path.name, kind))
                if parent == "Column" and column.search(own_text_objects_head(text)):
                    self.fail("%s: a %s inside a Column uses a vertical anchor" % (path.name, kind))

    def test_the_positioner_checker_sees_a_conflict_and_ignores_a_fine_anchor(self):
        sample = ('Item {\n Row {\n  Text { anchors.left: parent.left }\n  Text { anchors.verticalCenter: parent.verticalCenter }\n }\n'
                  ' Column {\n  Text { anchors.horizontalCenter: parent.horizontalCenter }\n  Rectangle { anchors.top: parent.top }\n }\n}\n')
        found = [(kind, parent) for kind, text, parent in walk(elements(sample))
                 if (parent == "Row" and re.search(r"anchors\.(left|right|horizontalCenter|fill|centerIn)", own_text_objects_head(text)))
                 or (parent == "Column" and re.search(r"anchors\.(top|bottom|verticalCenter|fill|centerIn)", own_text_objects_head(text)))]
        self.assertEqual(found, [("Text", "Row"), ("Rectangle", "Column")])

    def test_an_inline_component_does_not_reach_for_ids_outside_itself(self):
        # Inline components do not share the scope of the file they are declared
        # in, so an id from that file is undefined inside them.
        for path in QML:
            source = code(path.read_text(encoding="utf-8"))
            ids = set(re.findall(r"\bid:\s*(\w+)", source))
            for match in re.finditer(r"\bcomponent\s+\w+\s*:\s*\w+\s*\{", source):
                depth, i = 1, match.end()
                while i < len(source) and depth:
                    depth += {"{": 1, "}": -1}.get(source[i], 0)
                    i += 1
                body = source[match.end():i]
                own = set(re.findall(r"\bid:\s*(\w+)", body))
                for name in ids - own:
                    self.assertIsNone(re.search(r"\b" + name + r"\.", body),
                                      "%s: an inline component uses the outer id %s" % (path.name, name))


def own_text_objects_head(text):
    """Only the property lines at the top level of an object's body."""
    out, depth = [], 0
    for ch in text:
        if ch == "{":
            depth += 1
            if depth > 1:
                out.append(" ")
                continue
        elif ch == "}":
            depth -= 1
            continue
        out.append(ch if depth <= 1 else " ")
    return "".join(out)


if __name__ == "__main__":
    unittest.main()
