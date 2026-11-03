
## Application

Name

### Desription

## Web Application

Taisce is a PWA based web application that can be run on both Desktop browsers and on mobile devides.  Since it is a PWA it can be installed as an App on digital devices.

## Taisce Files

Most Taisce files are markdown files.   

When opening the app the list of files in the top level are displayed but the .md extension is not shown.

New directories can be created with nesting allowed. (P2)

Creation of a new file or direcrtory should be easy (eg a + ) .   

It must be possible to navigate up and down through the hierarchy. (P2)

On opening the app the most recent files modifed are shown (configurable in size) (P3) The list can be folded away and that choice is remembered.

A search functaion is provided to search based on the file name (in any directory) (P3)

## Markdown Editing

The UX for markfown editing needs to be done so the files look very clear and are beautiful to look at but also editing should be seamless and easy.

Auto save files - there must be no SAVE/CANCEL button.

Add an ability to undo edits up to a configurable limit (P4)

Openening a file must render it using the most common markdown featuers (https://www.markdownlang.com/).   The following must be suported

* Headings
* Text formatting (basic + advanced)
* Code formatting
* Lists including task lists
* Website links

Task lists are interactive: when the file is opened, clicking or touching a task
item's checkbox checks or unchecks it and the file is updated (auto-saved, no
edit mode needed).


To be decded is how the editing is done
* Is there an Edit button/mode to prevent unnecessary edits?
* Should an edit mode show RAW markdown (not aligned with UX goals)?
* Need abilityt ot add eg headers, lists, text formatting but keeping the clear rendered output (pseudo WYSWIG)

Add the abilityt to Paste an image.  This uploads the image to the directory as a file and links the image into the Markfown file (P4)

If there is a thrid party library that provides these requirements consider it for includsion (license permitting).

## Icon

Provide a beautiful, clear, stylish ICON that can be used for the following
* App favicon
* Included on README.md file
* Inclusion in the Web Application
* Used for Dropbox App media.  Needs a 64x64 and 256x256 sized image.

## Documentation

The Web app should include a documentation page showing how the app works and on mobile devides how to install as an app.  Keep minimal for initial implementation. (P3)

## Deployment

The Taisce web application is to be deployed using Github pages at the endpoint `https://ptaylor.github.io/taisce`.  

Deploymnet is done using a script that increments the current version on main branch, pushes main to a deployment branch (eg public) and tags the release using the version.

## Dropbox

An app called **Taisce** has been created with the following deatils;

* Permisssions
  - account_info.read
  - files.metadata.read
  - files.content.write
  - files.content.read
* App foder name: Taisce
* App key is `be0wdpfwojgf4p3`
* OAuth 2 redirect URL : http://localhost:8080/


Let me know if additional settings are needed and what Oauth 2 redirect URL must be added to match the deployment details in the previous section.


## Priorities

Some items have a priority following eg (P2) which indicates which phase the item should be implemnted in.  Items without a priotity are P1.




