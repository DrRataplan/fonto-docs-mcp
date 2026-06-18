import { test } from "node:test";
import assert from "node:assert/strict";
import { xmlToMarkdown } from "./fonto.js";
import { handleMcpRequest, MCP_TOOLS, MCP_RESOURCES, MCP_RESOURCE_TEMPLATES } from "./mcp.js";

const BASE = "https://documentation.fontoxml.com";

// ---------------------------------------------------------------------------
// API page tests  (<type> root)
// ---------------------------------------------------------------------------

test("API page: title and source line", () => {
  const xml = `<type><name>MyApi</name></type>`;
  const md = xmlToMarkdown(xml, "api/my-api");
  assert.match(md, /^# api\/my-api/);
  assert.match(md, /Source: https:\/\/documentation\.fontoxml\.com\/latest\/api\/my-api/);
  assert.match(md, /## MyApi/);
});

test("API page: description with paragraph and list", () => {
  const xml = `<type>
    <name>MyApi</name>
    <description>
      <paragraph>First paragraph text.</paragraph>
      <list>
        <list-item><paragraph>Item one</paragraph></list-item>
        <list-item><paragraph>Item two</paragraph></list-item>
      </list>
    </description>
  </type>`;
  const md = xmlToMarkdown(xml, "api/my-api");
  assert.match(md, /First paragraph text\./);
  assert.match(md, /- Item one/);
  assert.match(md, /- Item two/);
});

test("API page: member with parameters and return type", () => {
  const xml = `<type>
    <name>MyApi</name>
    <members>
      <type>
        <name>doSomething</name>
        <arguments>
          <type><name>options</name><restrict><type base="Object"/></restrict></type>
          <type><name>callback</name><restrict><type base="Function"/></restrict></type>
        </arguments>
        <return>
          <type><restrict><type base="Promise"/></restrict></type>
        </return>
      </type>
    </members>
  </type>`;
  const md = xmlToMarkdown(xml, "api/my-api");
  assert.match(md, /### `doSomething`/);
  assert.match(md, /\*\*Parameters:\*\*/);
  assert.match(md, /- `options`: `Object`/);
  assert.match(md, /- `callback`: `Function`/);
  assert.match(md, /\*\*Returns:\*\* `Promise`/);
});

test("API page: member with restrict base type label", () => {
  const xml = `<type>
    <name>Notifier</name>
    <members>
      <type>
        <name>subscribe</name>
        <restrict><type base="method"/></restrict>
      </type>
    </members>
  </type>`;
  const md = xmlToMarkdown(xml, "api/notifier");
  assert.match(md, /\*method\*/);
});

test("API page: code examples section", () => {
  const xml = `<type>
    <name>MyApi</name>
    <members>
      <type>
        <name>create</name>
        <description><codeblock>const x = create();</codeblock></description>
      </type>
    </members>
  </type>`;
  const md = xmlToMarkdown(xml, "api/my-api");
  assert.match(md, /## Examples/);
  assert.match(md, /```\nconst x = create\(\);\n```/);
});

test("API page: related pages deduplication", () => {
  const xml = `<type>
    <name>MyApi</name>
    <members>
      <type>
        <name>foo</name>
        <restrict><type reference="/latest/api/other-api"/></restrict>
      </type>
      <type>
        <name>bar</name>
        <restrict><type reference="/latest/api/other-api"/></restrict>
      </type>
    </members>
  </type>`;
  const md = xmlToMarkdown(xml, "api/my-api");
  const matches = [...md.matchAll(/api\/other-api/g)];
  assert.equal(matches.length, 1, "related page should appear only once");
});

test("API page: component props with required, optional, union, and simple types", () => {
  const xml = `<type>
    <name>FxProfileChip</name>
    <arguments>
      <type id="id-1">
        <name>profileId</name>
        <restrict>
          <restrict type="union">
            <type reference="/latest/profileid-abc"><name>ProfileId</name></type>
            <type base="null"/>
          </restrict>
        </restrict>
        <description><paragraph>ID of the profile.</paragraph></description>
      </type>
      <type id="id-2">
        <name>isCondensed</name>
        <restrict optional="true">
          <type base="boolean"/>
        </restrict>
        <description><paragraph>Show condensed chip.</paragraph></description>
      </type>
    </arguments>
  </type>`;
  const md = xmlToMarkdown(xml, "fxprofilechip-abc");
  assert.match(md, /## Component props/);
  assert.match(md, /### `profileId`/);
  assert.match(md, /\*Required\*/);
  assert.match(md, /\*\*Type:\*\* `ProfileId \| null`/);
  assert.match(md, /ID of the profile\./);
  assert.match(md, /### `isCondensed`/);
  assert.match(md, /\*Optional\*/);
  assert.match(md, /\*\*Type:\*\* `boolean`/);
  assert.match(md, /Show condensed chip\./);
});

test("API page: related pages excludes self-references", () => {
  const xml = `<type>
    <name>MyApi</name>
    <members>
      <type>
        <name>foo</name>
        <restrict><type reference="/latest/api/my-api#some-anchor"/></restrict>
      </type>
    </members>
  </type>`;
  const md = xmlToMarkdown(xml, "api/my-api");
  assert.doesNotMatch(md, /## Related pages/);
});

// ---------------------------------------------------------------------------
// DITA page tests  (topic / task / concept / reference roots)
// ---------------------------------------------------------------------------

test("DITA topic: title, source line, shortdesc", () => {
  const xml = `<topic id="t1">
    <title>Getting Started</title>
    <shortdesc>A quick overview.</shortdesc>
    <body/>
  </topic>`;
  const md = xmlToMarkdown(xml, "guide/getting-started");
  assert.match(md, /^# Getting Started/);
  assert.match(md, /Source: https:\/\/documentation\.fontoxml\.com\/latest\/guide\/getting-started/);
  assert.match(md, /> A quick overview\./);
});

test("DITA topic: body paragraphs", () => {
  const xml = `<topic id="t1">
    <title>Overview</title>
    <body>
      <p>First body paragraph.</p>
      <p>Second body paragraph.</p>
    </body>
  </topic>`;
  const md = xmlToMarkdown(xml, "guide/overview");
  assert.match(md, /First body paragraph\./);
  assert.match(md, /Second body paragraph\./);
});

test("DITA task: steps rendered as ordered list", () => {
  const xml = `<task id="t1">
    <title>Install Plugin</title>
    <taskbody>
      <steps>
        <step><cmd>Download the package.</cmd></step>
        <step><cmd>Run the installer.</cmd><info><p>Follow the on-screen prompts.</p></info></step>
      </steps>
    </taskbody>
  </task>`;
  const md = xmlToMarkdown(xml, "tasks/install");
  assert.match(md, /### Steps/);
  assert.match(md, /1\. Download the package\./);
  assert.match(md, /1\. Run the installer\./);
  assert.match(md, /Follow the on-screen prompts\./);
});

test("DITA reference: section with title and paragraphs", () => {
  const xml = `<reference id="r1">
    <title>Configuration Options</title>
    <refbody>
      <section>
        <title>Required settings</title>
        <p>You must set the apiKey option.</p>
      </section>
    </refbody>
  </reference>`;
  const md = xmlToMarkdown(xml, "ref/config");
  assert.match(md, /### Required settings/);
  assert.match(md, /You must set the apiKey option\./);
});

test("DITA topic: nav figures rendered as topics list", () => {
  const xml = `<topic id="t1">
    <title>Home</title>
    <body>
      <div>
        <fig>
          <title>Getting Started</title>
          <desc><p>Learn the basics.</p></desc>
          <data href="/latest/guide/start"/>
        </fig>
        <fig>
          <title>Advanced</title>
          <desc><p>Deep dives.</p></desc>
          <data href="/latest/guide/advanced"/>
        </fig>
      </div>
    </body>
  </topic>`;
  const md = xmlToMarkdown(xml, "home");
  assert.match(md, /### Topics/);
  assert.match(md, /\[Getting Started\]/);
  assert.match(md, /Learn the basics\./);
  assert.match(md, /\[Advanced\]/);
});

test("DITA topic: code examples section", () => {
  const xml = `<concept id="c1">
    <title>Example</title>
    <conbody>
      <codeblock>import fontoXml from 'fonto';</codeblock>
    </conbody>
  </concept>`;
  const md = xmlToMarkdown(xml, "guide/example");
  assert.match(md, /## Examples/);
  assert.match(md, /```\nimport fontoXml from 'fonto';\n```/);
});

test("DITA topic: simpletable rendered as Markdown table with inline codeph", () => {
  const xml = `<topic id="t1">
    <title>Files</title>
    <body>
      <simpletable>
        <sthead>
          <stentry><p>Name</p></stentry>
          <stentry><p>Purpose</p></stentry>
        </sthead>
        <strow>
          <stentry><p><codeph>config/</codeph></p></stentry>
          <stentry><p>Configuration directory.</p></stentry>
        </strow>
        <strow>
          <stentry><p><codeph>src/</codeph></p></stentry>
          <stentry><p>Source files.</p></stentry>
        </strow>
      </simpletable>
    </body>
  </topic>`;
  const md = xmlToMarkdown(xml, "guide/files");
  assert.match(md, /\| Name \| Purpose \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| `config\/` \| Configuration directory\. \|/);
  assert.match(md, /\| `src\/` \| Source files\. \|/);
});

test("DITA reference: simpletable inside section", () => {
  const xml = `<reference id="r1">
    <title>Config</title>
    <refbody>
      <section>
        <title>Options</title>
        <simpletable>
          <sthead>
            <stentry><p>Key</p></stentry>
            <stentry><p>Type</p></stentry>
          </sthead>
          <strow>
            <stentry><p>apiKey</p></stentry>
            <stentry><p>string</p></stentry>
          </strow>
        </simpletable>
      </section>
    </refbody>
  </reference>`;
  const md = xmlToMarkdown(xml, "ref/config");
  assert.match(md, /\| Key \| Type \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| apiKey \| string \|/);
});

test("DITA topic: missing title falls back to slug", () => {
  const xml = `<topic id="t1"><body/></topic>`;
  const md = xmlToMarkdown(xml, "guide/some-page");
  assert.match(md, /^# guide\/some-page/);
});

// ---------------------------------------------------------------------------
// mcp.js exports
// ---------------------------------------------------------------------------

test("mcp.js exports MCP_TOOLS as a non-empty array", () => {
  assert.ok(Array.isArray(MCP_TOOLS));
  assert.ok(MCP_TOOLS.length > 0);
  for (const tool of MCP_TOOLS) {
    assert.ok(tool.name, "each tool has a name");
    assert.ok(tool.description, "each tool has a description");
    assert.ok(tool.inputSchema, "each tool has an inputSchema");
  }
});

test("mcp.js exports MCP_RESOURCES as a non-empty array", () => {
  assert.ok(Array.isArray(MCP_RESOURCES));
  assert.ok(MCP_RESOURCES.length > 0);
  for (const resource of MCP_RESOURCES) {
    assert.ok(resource.uri, "each resource has a uri");
    assert.ok(resource.name, "each resource has a name");
  }
});

test("mcp.js exports MCP_RESOURCE_TEMPLATES as a non-empty array", () => {
  assert.ok(Array.isArray(MCP_RESOURCE_TEMPLATES));
  assert.ok(MCP_RESOURCE_TEMPLATES.length > 0);
  for (const tpl of MCP_RESOURCE_TEMPLATES) {
    assert.ok(tpl.uriTemplate, "each template has a uriTemplate");
    assert.ok(tpl.name, "each template has a name");
  }
});

test("mcp.js exports handleMcpRequest as a function", () => {
  assert.strictEqual(typeof handleMcpRequest, "function");
});
