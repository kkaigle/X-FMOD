import webview
import os
import sys

def main():
    # Get the directory where the script is running
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        base_dir = sys._MEIPASS
    else:
        # Running as script
        base_dir = os.path.dirname(os.path.abspath(__file__))

    html_file = os.path.join(base_dir, 'X-FMOD.html')

    window = webview.create_window(
        'X-FMOD Toolkit', 
        url=html_file, 
        width=1400, 
        height=900,
        resizable=True
    )
    
    webview.start()

if __name__ == '__main__':
    main()
