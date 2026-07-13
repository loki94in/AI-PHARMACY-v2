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
