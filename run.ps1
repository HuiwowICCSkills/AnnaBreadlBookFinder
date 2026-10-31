# Locate Node.js and run the headless Anna -> Breadl workflow.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    throw 'Node.js 22+ is required.'
}

& $node (Join-Path $PSScriptRoot 'scripts\anna_breadl_book_finder.mjs') @args
exit $LASTEXITCODE
