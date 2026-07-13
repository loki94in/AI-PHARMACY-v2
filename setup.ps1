Write-Output "Starting AI-PHARMACY-v2 Python Setup..."

# 1. Create requirements.txt
Write-Output "Creating requirements.txt..."
$req = @'
spacy==3.7.5
scispacy==0.6.2
click==8.4.2
'@
$req | Out-File -FilePath requirements.txt -Encoding utf8

# 2. Install dependencies via pip
Write-Output "Installing Python dependencies (this may take a few minutes)..."
pip install -r requirements.txt
pip install https://s3-us-west-2.amazonaws.com/ai2-s2-scispacy/releases/v0.5.4/en_core_sci_sm-0.5.4.tar.gz

# 3. Create the Python script directory
Write-Output "Creating python_scripts directory..."
if (-not (Test-Path python_scripts)) {
    New-Item -ItemType Directory -Path python_scripts
}

# 4. Write the SciSpacy extraction script
Write-Output "Writing extract_medicine.py..."
$code = @'
import sys
import warnings
warnings.filterwarnings("ignore")
import spacy
import json

def extract_medicine(text):
    try:
        # Load the biomedical model
        nlp = spacy.load("en_core_sci_sm")
        
        # Process the text
        doc = nlp(text)
        
        # Extract entities
        medicines = [ent.text for ent in doc.ents]
        
        # Print as JSON so Node.js can easily parse it
        print(json.dumps({"success": True, "medicines": medicines}))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        input_text = sys.argv[1]
        extract_medicine(input_text)
    else:
        print(json.dumps({"success": False, "error": "No text provided"}))
'@
$code | Out-File -FilePath python_scripts/extract_medicine.py -Encoding utf8

Write-Output "Setup Complete! SciSpacy is installed and your Python script is ready to be called by Node.js."
