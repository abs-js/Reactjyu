# Reacjyu 0.2.0

Reacjyu is a small frontend/backend environment for Cajyu projects. Version 0.2.0 fixes the library export, escapes HTML content, includes basic components, serves static files, and automatically updates the browser when project files are saved.

## Requirements
 - Node.js 18 or higher
 - Cajyu installed separately if you want to compile .cjy files with the Cajyu compiler(or you can use npx)

## Running

In your project folder:
```bash
npx reacjyu init
npx reacjyu run
```

Or, inside the project if the package is installed:
```bash
reacjyu run
```

## Useful options:

--port 3001
--index public/site.cjy
--host 0.0.0.0
--no-console

The default entry file is public/app.cjy; you can change it with reacjyu.index in package.json:
```json
{
  "reacjyu": {
    "index": "public/app.cjy"
  }
}
```

## Automatic Updates

Leave the server running, open http://localhost:3000, and save changes to .cjy, .js, .mjs, .html, .css, .json, or .svg files. The connected browser detects the change automatically.

.css files inside public/ are updated without reloading the page when they are already linked via a <link rel="stylesheet">. Changes to .cjy, JavaScript, HTML, and other files trigger an automatic reload.

Important limitation: this provides live reload and fast CSS updates, but it is not yet React's Fast Refresh. Code changes that reload the page reset the state that only existed in the browser; there is no incremental component reconciliation or automatic preservation of local state.

## Components

The CajyuLibs.reacjyu library exports Element, Button, Span, Div, Paragraph, Heading, Input, Link, Image, Form, List, ListItem, and escapeHTML.

Usage example (Cajyu syntax compatible with the current minimal renderer):
```Cajyu
import Button from CajyuLibs.reacjyu
import Heading from CajyuLibs.reacjyu
import Paragraph from CajyuLibs.reacjyu
export fn Site stats {
  var title = new Heading(1)
  title.append("My application")
  var description = new Paragraph()
  description.append("Save the file to see the change in the browser.")
  var button = new Button({ type: "button" })
  button.append("Click here")
  button.onclick = fn {
    element.textContent = "You clicked!"
  }
  return {
    html: {
      body: [title, description, button]
    }
  }
}
```
Event callbacks are sent to the browser and executed on the client side. They receive (event, element). They do not have automatic access to local server variables or renderer closures.

## State and Development Endpoints

GET /__reacjyu/state: returns the current backend state as JSON.
POST /__reacjyu/state: merges the properties of the received JSON object with the backend state.
POST /click: compatibility counter endpoint (contador).

These endpoints have no authentication and should only be used in a local/development environment. Do not expose the server directly to the internet without adding authentication and access controls.

## Console

.set <variable> <value> — sets a variable in the backend state.
.refresh frontend — updates the connected browsers.
.refresh backend — clears the backend state.
.refresh * — clears the state and updates the browsers.
.addOnSource <file.cjy> <route> — registers an additional page file, for example .addOnSource public/about.cjy /about.
.help — shows the commands.

## Known Limitations

Reacjyu is still beta. It is not an implementation of React: it has no JSX, virtual DOM, hooks, full routing, incremental reconciliation, or Fast Refresh with state preservation. The renderer understands a subset of Cajyu syntax and is designed for the export fn Site stats { ... } format. Currently, imports during rendering are limited to CajyuLibs.reacjyu and print from CajyuLibs.serial. For applications with untrusted users, code isolation and endpoint protection are necessary.
