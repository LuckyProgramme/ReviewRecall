# Automated Python Script usage

## daily-commit.py   
 - Main function is to easily commit and push repository progress in one command line usage is, push is by default, commit message is optional
When committing all changes
   py daily-commit.py all "Message-To-Commit" 

When committing specific file changes, use comma for file seperation "folder/file1, file1" 
   py daily-commit.py "folder/file1, file1" "Message-To-Commit" 

## Tip create a Powershell/Terminal function  to call specific file 
- "gpush" is the function 
 function gpush {
    py "C:/File directory" @args
}

Usage:  
   gpush "folder/file1, file1" "Message-To-Commit" 