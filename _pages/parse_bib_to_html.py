from pybtex.database import parse_file

def bib_to_html(bib_path):
    bib_data = parse_file(bib_path)
    html_content = "<div class='publications'>\n"

    for key, entry in bib_data.entries.items():
        title = entry.fields.get('title', 'No title')
        url = entry.fields.get('url', '#')
        authors = ", ".join(str(person) for person in entry.persons['author'])
        
        # 创建 HTML 结构
        html_content += f"<div class='publication-item'>\n"
        html_content += f"  <h3><a href='{url}'>{title}</a></h3>\n"
        html_content += f"  <p><strong>Authors:</strong> {authors}</p>\n"
        html_content += f"  <p><strong>Year:</strong> {entry.fields.get('year', 'N/A')}</p>\n"
        html_content += f"  <p><strong>Abstract:</strong> {entry.fields.get('abstract', 'No abstract available.')}</p>\n"
        html_content += "</div>\n"

    html_content += "</div>\n"
    return html_content

if __name__ == "__main__":
    html_content = bib_to_html('../_bibliography/papers.bib')
    with open('publications_generate.html', 'w', encoding='utf-8') as f:
        f.write(html_content)
