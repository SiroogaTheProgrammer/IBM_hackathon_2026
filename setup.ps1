<#
    One-command setup.

        .\setup.ps1              install dependencies, train if needed, run the demo
        .\setup.ps1 -SkipTrain   skip training (artifacts must already exist)
        .\setup.ps1 -Evaluate    also run the offline evaluation
#>
param(
    [switch]$SkipTrain,
    [switch]$Evaluate,
    [int]$Epochs = 40,
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

# --- 1. interpreter -------------------------------------------------------
Step "Python environment"
if (Test-Path ".venv\Scripts\python.exe") {
    $py = ".\.venv\Scripts\python.exe"
    Write-Host "using existing .venv"
} else {
    Write-Host "creating .venv ..."
    python -m venv .venv
    $py = ".\.venv\Scripts\python.exe"
}
& $py --version

# --- 2. dependencies ------------------------------------------------------
Step "Dependencies"
& $py -m pip install --upgrade pip --quiet
& $py -m pip install -r requirements.txt --quiet
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
Write-Host "ok"

# --- 3. tests -------------------------------------------------------------
Step "Tests"
& $py -m unittest discover -s behavioral_biometrics_nn/tests -t . 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "tests failed" }

# --- 4. base model --------------------------------------------------------
Step "Generic Siamese base model"
if ((Test-Path "artifacts\encoder.pt") -and $SkipTrain) {
    Write-Host "artifacts\encoder.pt exists, skipping training"
} elseif (Test-Path "artifacts\encoder.pt") {
    Write-Host "artifacts\encoder.pt exists. Re-training (pass -SkipTrain to reuse) ..."
    & $py train_base_model.py --epochs $Epochs
} else {
    Write-Host "training from training_files\ (this is the slow step) ..."
    & $py train_base_model.py --epochs $Epochs
}
if ($LASTEXITCODE -ne 0) { throw "training failed" }

# --- 5. optional evaluation ----------------------------------------------
if ($Evaluate) {
    Step "Offline evaluation"
    & $py evaluate_model.py --max-test-sessions 12
}

# --- 6. demo --------------------------------------------------------------
Step "Demo dashboard"
Write-Host "starting on http://127.0.0.1:$Port  (Ctrl+C to stop)"
& $py run_demo.py --port $Port
